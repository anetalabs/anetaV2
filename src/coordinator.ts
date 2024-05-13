import { cardanoWatcher } from "./cardano.js"
import { bitcoinWatcher } from "./bitcoin.js";
import EventEmitter from "events";
import { requestId } from "./helpers.js";
export const emitter = new EventEmitter();
import { redemptionRequest, mintRequest,  utxo , protocolConfig, MintRequestSchema} from "./types.js";
import { getDb } from "./db.js";
import { Collection } from "mongodb";
import { emit } from "process";

enum state {
    open,
    commited,
    payed,
    completed,
    finished
}

enum redemptionState{
    open,
    forged,
    burned,
    completed,
}

interface redemptionController{
    state : redemptionState,
    currentTransaction?: string
    requestsFilling?: redemptionRequest[]
    burningTransaction?: string,
    redemptionTx?: string
}

interface paymentPaths{
    state: state,
    address: string,
    index: number,
    request?: mintRequest,
    payment?: utxo[] | null,
    fulfillment?: string | null
} 

export class coordinator{
    cardanoWatcher: cardanoWatcher
    bitcoinWatcher: bitcoinWatcher
    paymentPaths: paymentPaths[]
    config: protocolConfig
    redemptionState: redemptionController
    redemptionDb: Collection<redemptionController>

    constructor(cardanoWatcher : cardanoWatcher, bitcoinWatcher : bitcoinWatcher, protocol: protocolConfig){
        this.cardanoWatcher = cardanoWatcher;
        this.bitcoinWatcher = bitcoinWatcher;
        this.config  = protocol
        this.redemptionDb = getDb(cardanoWatcher.getDbName()).collection("redemptionState");

        (async () => {
            this.redemptionState = await this.redemptionDb.findOne({}) || {state: redemptionState.open};
        })();
        
        this.paymentPaths = Array.from({length: this.bitcoinWatcher.getPaymentPaths()}, (_, index) => index).map((index) => {return {state: state.open, index: index , address: this.bitcoinWatcher.getAddress(index)}});
        this.getOpenRequests = this.getOpenRequests.bind(this);
        this.onNewCardanoBlock = this.onNewCardanoBlock.bind(this); 
       
        emitter.on("newCardanoBlock", this.onNewCardanoBlock);
        emitter.on("newBtcBlock", this.onNewBtcBlock.bind(this));

    }

    
    async getOpenRequests(){
        let [mintRequests , redemptionRequests] = await this.cardanoWatcher.queryValidRequests();


        console.log("Mint Requests", mintRequests);
        console.log("Redemption Requests", redemptionRequests);
        mintRequests.forEach((request) => {
            const index = request.decodedDatum.path;
            console.log("Minting request", request);
            if (this.paymentPaths[index].state === state.open){
                this.paymentPaths[index].state = state.commited;
                this.paymentPaths[index].request = request;
            }else if (!this.paymentPaths[index].request || requestId(this.paymentPaths[index].request) !==  requestId(request)){
                console.log("Payment Pathway already in use, rejecting request");
                this.cardanoWatcher.rejectRequest(request.txHash, request.outputIndex);
            }
        });

        console.log("redeption state", this.redemptionState);  

        if(  redemptionRequests.length  > 0 && this.redemptionState.state === redemptionState.open){
            try{
                
                this.redemptionState.currentTransaction = await this.bitcoinWatcher.craftRedemptionTransaction(redemptionRequests);
                this.redemptionState.state = redemptionState.forged;
                this.redemptionState.requestsFilling = redemptionRequests;
                this.redemptionState.burningTransaction = await this.cardanoWatcher.burn(redemptionRequests, this.redemptionState.currentTransaction);
                // store the transaction in the database
                this.redemptionDb.findOneAndUpdate({}, {$set: this.redemptionState}, {upsert: true});

            }catch(e){
                console.log("Error crafting redemption transaction", e);
            }
        }
        
    }

    async onNewCardanoBlock(){
      console.log("New Cardano Block event");
      
      await this.getOpenRequests();  
      await this.checkBurn(); 
      emitter.emit("paymentPathsUpdate", this.paymentPaths);
    }

    async onNewBtcBlock(){
        console.log("New BTC Block event");       
        this.checkPayments() 
        this.checkRedemption();
    }

    async checkBurn(){
        if(this.redemptionState.state === redemptionState.forged ){
            if(await this.cardanoWatcher.isBurnConfirmed(this.redemptionState.burningTransaction)){
                this.redemptionState.state = redemptionState.burned;
                this.redemptionDb.findOneAndUpdate({}, {$set: this.redemptionState}, {upsert: true});
            }   
        }

        if(this.redemptionState.state === redemptionState.burned){
            this.redemptionState.redemptionTx = await this.bitcoinWatcher.completeRedemption(this.redemptionState.currentTransaction);
            this.redemptionDb.findOneAndUpdate({}, {$set: this.redemptionState}, {upsert: true});

        }
    }

    async checkPayments(){
 
        this.paymentPaths.forEach((path, index) => {
            let payment = this.bitcoinWatcher.getUtxosByIndex(index);
            if(path.state <= state.completed && payment.length > 0){

                payment.forEach(async (utxo) => {
                    if(await this.cardanoWatcher.paymentProcessed(utxo)){
                        path.state = state.completed;
                    }
                });
            }

            if(path.state === state.finished && payment.length  === 0){
                path = {state: state.open, index: index , address: this.bitcoinWatcher.getAddress(index)};
            }


            if (path.state === state.commited && payment.length > 0){
                let sum = this.bitcoinWatcher.btcToSat(payment.reduce((acc, utxo) => acc + utxo.amount, 0));
                const fee = this.bitcoinWatcher.btcToSat(this.config.fixedFee) 
                + this.config.margin * Number(path.request.decodedDatum.amount)
                + this.config.utxoCharge * (payment.length -1);
                
                console.log(`checking payment for path ${index} 
                            current total payment: ${sum}
                            utxos: ${payment.length}
                            fee: ${fee}
                            minting amount: ${path.request.decodedDatum.amount}
                            total payment required: ${Number(path.request.decodedDatum.amount) + fee} `.trim());

                if(sum  >= (Number(path.request.decodedDatum.amount) + fee)){
                    console.log("Payment found");
                    path.state = state.payed;
                    path.payment = payment;
                    this.cardanoWatcher.fulfillRequest(path.request.txHash, path.request.outputIndex, payment);
                }
            }
            
        });    

        this.consolidatePayments();
        
    }

    async checkRedemption(){
        if(this.redemptionState.state === redemptionState.burned){
            if(await this.bitcoinWatcher.isRedemptionConfirmed(this.redemptionState.redemptionTx)){
                this.redemptionState.state = redemptionState.completed;
                this.redemptionDb.findOneAndUpdate({}, {$set: this.redemptionState}, {upsert: true});
            }
        }
    }

    async consolidatePayments(){
        
        // if more than half of the payment paths are completed, consolidate the payments
        let completed = this.paymentPaths.filter((path) => path.state === state.completed).map((path) => path.index);
        
        const threholdFilled = completed.length > this.bitcoinWatcher.getPaymentPaths()*this.config.consolidationThreshold;
        const currentHeight = await this.bitcoinWatcher.getHeight();
        let maxWait = 0;
    
        completed.forEach((index) => {  
            this.bitcoinWatcher.getUtxosByIndex(index).forEach((utxo) => {
                if(maxWait < currentHeight - utxo.height){
                    maxWait = currentHeight - utxo.height;
                }
            });
        });

        const timeToConsolidate = maxWait > this.config.maxConsolidationTime;

        if(threholdFilled || timeToConsolidate){
            console.log("Consolidating payments");
            await this.bitcoinWatcher.consolidatePayments(completed);
            completed.forEach((index) => {
                this.paymentPaths[index].state = state.finished;
            });
        }
    }
}