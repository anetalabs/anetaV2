import { BTCWatcher  , ADAWatcher } from "./index.js";
import EventEmitter from "events";
import { requestId } from "./helpers.js";
export const emitter = new EventEmitter();
import { redemptionRequest, mintRequest,  utxo , protocolConfig, MintRequestSchema} from "./types.js";
import { getDb } from "./db.js";
import { Collection } from "mongodb";

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

export class Coordinator{

    paymentPaths: paymentPaths[]
    config: protocolConfig
    redemptionState: redemptionController
    redemptionDb: Collection<redemptionController>

    constructor( protocol: protocolConfig){
        this.config  = protocol
        this.redemptionDb = getDb(ADAWatcher.getDbName()).collection("redemptionState");

        (async () => {
            this.redemptionState = await this.redemptionDb.findOne({}) || {state: redemptionState.open};
        })();
        
        this.paymentPaths = Array.from({length: BTCWatcher.getPaymentPaths()}, (_, index) => index).map((index) => {return {state: state.open, index: index , address: BTCWatcher.getAddress(index)}});
        this.getOpenRequests = this.getOpenRequests.bind(this);
        this.onNewCardanoBlock = this.onNewCardanoBlock.bind(this); 
       
        emitter.on("newCardanoBlock", this.onNewCardanoBlock);
        emitter.on("newBtcBlock", this.onNewBtcBlock.bind(this));

    }

    
    async getOpenRequests(){
        let [mintRequests , redemptionRequests] = await ADAWatcher.queryValidRequests();

        

        //console.log("Mint Requests", mintRequests);
        //console.log("Redemption Requests", redemptionRequests);
        mintRequests.forEach((request) => {
            const index = request.decodedDatum.path;
            console.log("Minting request", request);
            if (this.paymentPaths[index].state === state.open){
                this.paymentPaths[index].state = state.commited;
                this.paymentPaths[index].request = request;
            }else if (!this.paymentPaths[index].request || requestId(this.paymentPaths[index].request) !==  requestId(request)){
                console.log("Payment Pathway already in use, rejecting request");
                ADAWatcher.rejectRequest(request.txHash, request.outputIndex);
            }
        });

        
        console.log("redeption state", this.redemptionState);  

        if(  redemptionRequests.length  > 0 && this.redemptionState.state === redemptionState.open){
            try{
                
                this.redemptionState.currentTransaction = await BTCWatcher.craftRedemptionTransaction(redemptionRequests);
                this.redemptionState.state = redemptionState.forged;
                this.redemptionState.requestsFilling = redemptionRequests;
                this.redemptionState.burningTransaction = await ADAWatcher.burn(redemptionRequests, this.redemptionState.currentTransaction);
                // store the transaction in the database
                this.redemptionDb.findOneAndUpdate({}, {$set: this.redemptionState}, {upsert: true});

            }catch(e){
                console.log("Error crafting redemption transaction", e);
            }
        }
        
    }

    getPaymentPaths(){  
        return this.paymentPaths;
    }

    async onNewCardanoBlock(){
     
      await this.getOpenRequests();  
      await this.checkBurn(); 
    }

    async onNewBtcBlock(){
        console.log("New BTC Block event");       
        this.checkPayments() 
        this.checkRedemption();
    }

    async checkBurn(){
        if(this.redemptionState.state === redemptionState.forged ){
            if(await ADAWatcher.isBurnConfirmed(this.redemptionState.burningTransaction)){
                this.redemptionState.state = redemptionState.burned;
                this.redemptionDb.findOneAndUpdate({}, {$set: this.redemptionState}, {upsert: true});
            }   
        }

        if(this.redemptionState.state === redemptionState.burned){
            this.redemptionState.redemptionTx = await BTCWatcher.completeRedemption(this.redemptionState.currentTransaction);
            this.redemptionDb.findOneAndUpdate({}, {$set: this.redemptionState}, {upsert: true});

        }
    }

    async checkPayments(){
 
        this.paymentPaths.forEach((path, index) => {
            let payment = BTCWatcher.getUtxosByIndex(index);
            if(path.state <= state.completed && payment.length > 0){
                payment.forEach(async (utxo) => {
                    if(await ADAWatcher.paymentProcessed(utxo.txid, utxo.vout)){
                        path.state = state.completed;
                    }
                });
            }


            if(path.state === state.finished && payment.length  === 0){
                path = {state: state.open, index: index , address: BTCWatcher.getAddress(index)};
            }


            if (path.state === state.commited && payment.length > 0){
                let sum = BTCWatcher.btcToSat(payment.reduce((acc, utxo) => acc + utxo.amount, 0));
                const fee = BTCWatcher.btcToSat(this.config.fixedFee) 
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
                    ADAWatcher.completeMint(path.request.txHash, path.request.outputIndex, payment);
                }
            }
            
        });    

        this.consolidatePayments();
        
    }

    async checkRedemption(){
        if(this.redemptionState.state === redemptionState.burned){
            if(await BTCWatcher.isRedemptionConfirmed(this.redemptionState.redemptionTx)){
                this.redemptionState.state = redemptionState.completed;
                this.redemptionDb.findOneAndUpdate({}, {$set: this.redemptionState}, {upsert: true});
            }
        }
    }

    async consolidatePayments(){
        
        // if more than half of the payment paths are completed, consolidate the payments
        let completed = this.paymentPaths.filter((path) => path.state === state.completed).map((path) => path.index);
        
        const threholdFilled = completed.length > BTCWatcher.getPaymentPaths()*this.config.consolidationThreshold;
        const currentHeight = await BTCWatcher.getHeight();
        let maxWait = 0;
    
        completed.forEach((index) => {  
            BTCWatcher.getUtxosByIndex(index).forEach((utxo) => {
                if(maxWait < currentHeight - utxo.height){
                    maxWait = currentHeight - utxo.height;
                }
            });
        });

        const timeToConsolidate = maxWait > this.config.maxConsolidationTime;

        if(threholdFilled || timeToConsolidate){
            console.log("Consolidating payments");
            await BTCWatcher.consolidatePayments(completed);
            completed.forEach((index) => {
                this.paymentPaths[index].state = state.finished;
            });
        }
    }

}