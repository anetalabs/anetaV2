import { BTCWatcher  , ADAWatcher, communicator, coordinator } from "./index.js";
import EventEmitter from "events";
import { requestId } from "./helpers.js";
export const emitter = new EventEmitter();
import { redemptionRequest, mintRequest,  utxo , protocolConfig, MintRequestSchema, redemptionController, redemptionState} from "./types.js";
import {Psbt} from "bitcoinjs-lib";
import { getDb } from "./db.js";
import { Collection } from "mongodb";

enum state {
    open,
    commited,
    payed,
    completed,
    finished
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
                const documents = await this.redemptionDb.find().sort({ index: -1 }).limit(1).toArray();
                this.redemptionState = documents[0] || {state: redemptionState.open, index: 0};  
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
            if (request.decodedDatum.amount < this.config.minMint){
                console.log("Minting amount too low, rejecting request");
                ADAWatcher.rejectRequest(request.txHash, request.outputIndex);
            }
            if (this.paymentPaths[index].state === state.open ){
                this.paymentPaths[index].state = state.commited;
                this.paymentPaths[index].request = request;
            }else if (!this.paymentPaths[index].request || requestId(this.paymentPaths[index].request) !==  requestId(request)){
                console.log("Payment Pathway already in use, rejecting request");
                ADAWatcher.rejectRequest(request.txHash, request.outputIndex);
            }
        });

        if (redemptionRequests.length > 0 && this.redemptionState.state === redemptionState.open) {
            try {
                if(communicator.amILeader()){
                    let [currentTransaction, requests] = await BTCWatcher.craftRedemptionTransaction(redemptionRequests);
                    await this.newRedemption(currentTransaction, requests);
                }else{
                    communicator.leaderBroadcast("queryRedemption");
                }
            } catch (e) {
                console.log("Error crafting redemption transaction", e);
            }
        }
        
    }

    getRedemptionState(){
        return this.redemptionState;
        
    }

    async importRedemption(newRedemptionState: redemptionController){
        const redemptionOk = BTCWatcher.checkRedemptionTx(newRedemptionState.currentTransaction, newRedemptionState.burningTransaction);
        

        if(this.redemptionState.state !==  redemptionState.open ) throw new Error("Redemption already in progress");

        if (!redemptionOk) throw new Error("Redemption transaction is not valid");

        this.redemptionState = newRedemptionState;
        await this.redemptionDb.findOneAndUpdate({ index : this.redemptionState.index }, { $set: this.redemptionState }, { upsert: true });
    }

    async newRedemption(currentTransaction: Psbt ,redemptionRequests: redemptionRequest[]) {
        try {
            const [burnTx, signature ] = (await ADAWatcher.burn(redemptionRequests, currentTransaction.toHex()))
            const redemptionOk = BTCWatcher.checkRedemptionTx(currentTransaction.toHex(), burnTx.toString());
        
        if (!redemptionOk) throw new Error("Redemption transaction is not valid");
        if (this.redemptionState.state !== redemptionState.open) throw new Error("Redemption already in progress");
            this.redemptionState.burningTransaction = burnTx.toString();
            this.redemptionState.currentTransaction = currentTransaction.toHex();
            this.redemptionState.burnSignatures = [signature];
            this.redemptionState.state = redemptionState.forged;
            this.redemptionState.index = this.redemptionState.index + 1;
            // store the transaction in the database
             console.log("New redemption", this.redemptionState)
            await this.redemptionDb.findOneAndUpdate({ index : this.redemptionState.index  }, { $set: this.redemptionState }, { upsert: true });
            if(communicator.amILeader) communicator.broadcast("newRedemption", this.redemptionState);
        }catch(e){
            console.log("Error in new redemption", e);
        }
    }

    getConfig(){    
        return this.config;
    }

    calculatePaymentAmount(request: mintRequest , utxoNumber : number = 1  ){
        return Number(request.decodedDatum.amount) + this.config.fixedFee + this.config.margin *  Number(request.decodedDatum.amount) + this.config.utxoCharge * (utxoNumber - 1) ; 
    }

    calculateRedemptionAmount(request: redemptionRequest){
        const cBtcId = ADAWatcher.getCBtcId();
        return  Number(request.assets[cBtcId])  - this.config.fixedFee - this.config.redemptionMargin *  Number(request.assets[cBtcId]);
    }

    getPaymentPaths(){  
        return this.paymentPaths;
    }

    async onNewCardanoBlock(){
        console.log("New Cardano Block event");
      await this.getOpenRequests();  
      await this.checkBurn(); 
///////////////////////////////////////////////
      this.checkRedemption();
////////////////////////////////////////////////      

    }

    async onNewBtcBlock(){
        console.log("New BTC Block event");       
        this.checkPayments() 
        this.checkRedemption();
    }

    getBurnTx(){
        return this.redemptionState.burningTransaction;
    }

    async newBurnSignature(signature: string){
        if(this.redemptionState.state !== redemptionState.forged) return;

        if(!this.redemptionState.burnSignatures.includes(signature)) 
            this.redemptionState.burnSignatures.push(signature);

        if(this.redemptionState.burnSignatures.length >= BTCWatcher.getM()){ 
            const burnTx =  ADAWatcher.txCompleteFromString(this.getBurnTx());     

            const completedTx = (await burnTx.assemble(this.redemptionState.burnSignatures).complete())
            ADAWatcher.submitTransaction(completedTx);
        }
    }

    updateRedemptionId(txId: string, index: number){
        if(this.redemptionState.state === redemptionState.finalized) return;
        this.redemptionState.redemptionTxId = txId;
        this.redemptionState.state = redemptionState.finalized;
        this.redemptionState.index = index;
        this.redemptionState.redemptionTx = txId;
        this.redemptionDb.findOneAndUpdate({ index : this.redemptionState.index }, {$set: this.redemptionState}, {upsert: true});
    }

    async newRedemptionSignature(signature: string){
        if(this.redemptionState.state === redemptionState.finalized)
            communicator.broadcast("updateRedemptionId", { txId: this.redemptionState.redemptionTxId, index: this.redemptionState.index }); 

        if(this.redemptionState.state === redemptionState.completed) 
            communicator.broadcast("completedRedemption", { txId: this.redemptionState.redemptionTxId, index: this.redemptionState.index , tx: this.redemptionState.redemptionSignatures});

        if(this.redemptionState.state !== redemptionState.burned) return;
        const tx = BTCWatcher.combine(BTCWatcher.psbtFromHex(this.redemptionState.redemptionSignatures), signature);
        this.redemptionState.redemptionSignatures = tx.toHex();
        await this.redemptionDb.findOneAndUpdate({ index : this.redemptionState.index }, {$set: this.redemptionState}, {upsert: true});
        try{
            if(tx.data.inputs[0].partialSig.length >= BTCWatcher.getM()){
                const redemptionTxId = await BTCWatcher.completeAndSubmit(tx);
                this.redemptionState.state = redemptionState.completed;
                this.redemptionState.redemptionTxId = redemptionTxId;
                await this.redemptionDb.findOneAndUpdate({ index : this.redemptionState.index }, {$set: this.redemptionState}, {upsert: true});
            }
        }catch(err){
            console.log("consolidation error:", err);
        }
    }

    async checkBurn(){
        if(this.redemptionState.state === redemptionState.forged ){
            ADAWatcher.signBurn(this.redemptionState.burningTransaction);

            if(await ADAWatcher.isBurnConfirmed(this.redemptionState.burningTransaction)){
                this.redemptionState.state = redemptionState.burned;
                await this.redemptionDb.findOneAndUpdate({ index : this.redemptionState.index }, {$set: this.redemptionState}, {upsert: true});
            }   
        }
        
        if(this.redemptionState.state === redemptionState.burned){
            const sig =  await BTCWatcher.signRedemptionTransaction(this.redemptionState.currentTransaction);
            if(communicator.amILeader()){
                this.redemptionState.redemptionSignatures = sig;
            }else{
                //sleep 2 sec and broadcast signature
                await new Promise((resolve) => setTimeout(resolve, 2000));
                communicator.leaderBroadcast("newRedemSignature", sig);
            }

            await this.redemptionDb.findOneAndUpdate({ index : this.redemptionState.index }, {$set: this.redemptionState}, {upsert: true});
            
        }
    }
 
    async checkRedemption(){
        console.log("Checking redemption");
        if(this.redemptionState.state === redemptionState.completed){
         if(await BTCWatcher.isTxConfirmed(this.redemptionState.redemptionTxId)){
            this.redemptionState.state = redemptionState.finalized;
            await this.redemptionDb.findOneAndUpdate({ index : this.redemptionState.index }, {$set: this.redemptionState}, {upsert: true});
         }
        //         this.redemptionState.state = redemptionState.completed;
        //         await this.redemptionDb.findOneAndUpdate({ index : this.redemptionState.index }, {$set: this.redemptionState}, {upsert: true});
        //     }

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
                const totalToPay = this.calculatePaymentAmount(path.request);
                
                console.log(`checking payment for path ${index} 
                            current total payment: ${sum}
                            utxos: ${payment.length}
                            minting amount: ${path.request.decodedDatum.amount}
                            fee: ${this.config.fixedFee}
                            total payment required: ${totalToPay} `.trim());

                if(sum  >= totalToPay){
                    console.log("Payment found");
                    path.state = state.payed;
                    path.payment = payment;
                    ADAWatcher.completeMint(path.request.txHash, path.request.outputIndex, payment);
                }
            }
            
        });    
        this.consolidatePayments();
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