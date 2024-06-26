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
    openTime?: number
} 

export class Coordinator{
    paymentPaths: paymentPaths[]
    paymentPathsDb: Collection<paymentPaths>
    config: protocolConfig
    redemptionState: redemptionController
    redemptionDb: Collection<redemptionController>

    constructor( protocol: protocolConfig){
        this.config  = protocol
        this.redemptionDb = getDb(ADAWatcher.getDbName()).collection("redemptionState");
        this.paymentPathsDb = getDb(ADAWatcher.getDbName()).collection("paymentPaths");
        (async () => {
            const documents = await this.redemptionDb.find().sort({ index: -1 }).limit(1).toArray();
            this.redemptionState = documents[0] || {state: redemptionState.open, index: 0};  
           
            this.paymentPaths = await Promise.all(
                Array.from({length: BTCWatcher.getPaymentPaths()}, (_, index) => index).map(async (index) => {
                    const paymentPath = await this.paymentPathsDb.findOne({index});
                    return paymentPath || {state: state.open, index, address: BTCWatcher.getAddress(index)};
                })
        );

        })();
        this.getOpenRequests = this.getOpenRequests.bind(this);
        this.onNewCardanoBlock = this.onNewCardanoBlock.bind(this); 
       
        emitter.on("newCardanoBlock", this.onNewCardanoBlock);
        emitter.on("newBtcBlock", this.onNewBtcBlock.bind(this));

    }

    
    async getOpenRequests(){
        let [mintRequests , redemptionRequests] = await ADAWatcher.queryValidRequests();
        
        console.log("Checking requests", mintRequests, redemptionRequests);

        //console.log("Mint Requests", mintRequests);
        //console.log("Redemption Requests", redemptionRequests);
        this.paymentPaths.forEach( (paymentPath, index) => {
            if(paymentPath.state === state.commited && mintRequests.find((mintRequest) => requestId(mintRequest) === requestId(paymentPath.request)) === undefined){
                console.log("Payment path not found, reopening");
                paymentPath = {state: state.open, index: paymentPath.index, address: BTCWatcher.getAddress(paymentPath.index)};
                this.paymentPaths[index] = paymentPath;
                this.paymentPathsDb.deleteOne({ index: paymentPath.index });
            }
        });
        try{
            console.log("fee Rate", await BTCWatcher.getFee());
        }catch(e){
            console.log("Error getting fee rate", e);
        }
        mintRequests.forEach((request) => {
            const index = request.decodedDatum.path;
            if (request.decodedDatum.amount < this.config.minMint){
                console.log("Minting amount too low, rejecting request");
                ADAWatcher.rejectRequest(request.txHash, request.outputIndex);
                return;
            }
            if( Number(request.assets.lovelace) !== this.config.mintDeposit * 1000000){
                console.log("Invalid deposit, rejecting request");
                ADAWatcher.rejectRequest(request.txHash, request.outputIndex);
                return;
            }

            if (this.paymentPaths[index].state === state.open ){
                this.paymentPaths[index].state = state.commited;
                this.paymentPaths[index].request = request;
                this.paymentPaths[index].openTime = Date.now();
                this.paymentPathsDb.findOneAndUpdate({ index }, { $set: this.paymentPaths[index] }, { upsert: true });
            }else if (!this.paymentPaths[index].request || requestId(this.paymentPaths[index].request) !==  requestId(request)){
                console.log("Payment Pathway already in use, rejecting request");
                ADAWatcher.rejectRequest(request.txHash, request.outputIndex);
            }

            if (this.paymentPaths[index].state === state.payed){
                ADAWatcher.completeMint(request.txHash, request.outputIndex, this.paymentPaths[index].payment)
            }
        });

        if (redemptionRequests.length > 0 && [redemptionState.open, redemptionState.finalized].includes(this.redemptionState.state)) {
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

    async checkTimeout(){
        this.paymentPaths.forEach((path, index) => {
            if (path.state === state.commited && Date.now() - path.openTime > this.config.mintTimeoutMinutes * 60000){
                console.log("Payment path timed out");
                ADAWatcher.confescateDeposit(path.request.txHash, path.request.outputIndex);
            }
        });
        
    }

    getRedemptionState(){
        return this.redemptionState;
        
    }

    async importRedemption(newRedemptionState: redemptionController){
        try{
            console.log("Importing redemption", newRedemptionState);
            if(newRedemptionState.index !== this.redemptionState.index + 1) throw new Error("Redemption index is lower than current index");
            const redemptionOk = BTCWatcher.checkRedemptionTx(newRedemptionState.currentTransaction, newRedemptionState.burningTransaction);
            
            console.log("Redemption state, current state", newRedemptionState.state, this.redemptionState.state);
            if( ![redemptionState.open, redemptionState.finalized, redemptionState.forged].includes(this.redemptionState.state) ) throw new Error("Redemption already in progress");

            if(this.redemptionState.state === redemptionState.forged){
                if ( communicator.checkAdaQuorum(ADAWatcher.getTxSigners(this.redemptionState.burningTransaction) )){
                     throw new Error("Redemption already forged, waiting for burn signatures");
                }else{
                    console.log("Quorum not met, recreating redemption transaction");
                    this.redemptionState.state = redemptionState.cancelled;
                    await this.redemptionDb.findOneAndUpdate({ index : this.redemptionState.index }, { $set: this.redemptionState }, { upsert: true });
                }
                
              }

            if (!redemptionOk) throw new Error("Redemption transaction is not valid");

            this.redemptionState = newRedemptionState;
            await this.redemptionDb.findOneAndUpdate({ index : this.redemptionState.index }, { $set: this.redemptionState }, { upsert: true });
        }catch(e){
            console.log("Error in importing redemption", e);
        }
    }

    async newRedemption(currentTransaction: Psbt ,redemptionRequests: redemptionRequest[]) {
        console.log("Staring New redemption")
        try {
            const [burnTx, signature ] = (await ADAWatcher.burn(redemptionRequests, currentTransaction.toHex()))
            const redemptionOk = BTCWatcher.checkRedemptionTx(currentTransaction.toHex(), burnTx.toString());
        
        if (!redemptionOk) throw new Error("Redemption transaction is not valid");

        if (![redemptionState.open, redemptionState.finalized, redemptionState.forged].includes(this.redemptionState.state) ) throw new Error("Redemption already in progress");

        if(this.redemptionState.state === redemptionState.forged){ 
            if ( communicator.checkAdaQuorum(ADAWatcher.getTxSigners(this.redemptionState.burningTransaction) )){
                throw new Error("Redemption already forged, waiting for burn signatures");
            }else{
                    console.log("Quorum not met, recreating redemption transaction");
                    this.redemptionState.state = redemptionState.cancelled;
                    await this.redemptionDb.findOneAndUpdate({ index : this.redemptionState.index }, { $set: this.redemptionState }, { upsert: true });
            }
        }

        this.redemptionState = {
            index: this.redemptionState.index + 1 , 
            state: redemptionState.forged,
            currentTransaction: currentTransaction.toHex(),
            burningTransaction: burnTx.toString(),
            burnSignatures: [signature],
        };
            // this.redemptionState.burningTransaction = burnTx.toString();
            // this.redemptionState.currentTransaction = currentTransaction.toHex();
            // this.redemptionState.burnSignatures = [signature];
            // this.redemptionState.state = redemptionState.forged;
            // this.redemptionState.index = this.redemptionState.index + 1;
            // store the transaction in the database
             
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
      if(BTCWatcher.inSync() === false) return;
      await this.getOpenRequests(); 
      await this.checkTimeout(); 
      await this.checkBurn(); 
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
            console.log("Burn signatures complete", burnTx);
        }
    }

    async updateRedemptionToComplete(data: { index: number, tx: string}){
        console.log("Updating redemption to complete", data);
        const redemption = await this.redemptionDb.findOne({ index : data.index });

        if(redemption.state >= redemptionState.completed) return;
        
        if(BTCWatcher.txEqual(redemption.currentTransaction, data.tx) && redemption.state === redemptionState.burned ){
            console.log("Redemption finalized, updating to completed"); 
            
            redemption.redemptionTxId = BTCWatcher.getTxId(data.tx);
            redemption.state = redemptionState.completed;
            redemption.redemptionSignatures = data.tx;
            this.redemptionDb.findOneAndUpdate({ index : redemption.index }, {$set: redemption}, {upsert: true});
            if(redemption.index === this.redemptionState.index){
                this.redemptionState = redemption;
            }

            BTCWatcher.completeAndSubmit(BTCWatcher.psbtFromHex(data.tx)).then((txId) => {
                console.log("Transaction completed and submitted", txId , "redemption");   
           }).catch((err) => {
               console.log("Error completing and submitting transaction", err);
           });
            this.checkRedemption();
        }
        
    }

    async newRedemptionSignature(signature: string, redemptionIndex : number){
        try{
        if(this.redemptionState.state >= redemptionState.completed || this.redemptionState.index !== redemptionIndex) {
            const redemption = await this.redemptionDb.findOne({ index : redemptionIndex });
            communicator.broadcast("updateRedemptionToComplete", {  index: redemption.index , tx: redemption.redemptionSignatures});
        }
        
        if(this.redemptionState.state !== redemptionState.burned) return;

        const tx = BTCWatcher.combine(BTCWatcher.psbtFromHex(this.redemptionState.redemptionSignatures), signature);
        this.redemptionState.redemptionSignatures = tx.toHex();
        await this.redemptionDb.findOneAndUpdate({ index : this.redemptionState.index }, {$set: this.redemptionState}, {upsert: true});
            if(tx.data.inputs[0].partialSig.length >= BTCWatcher.getM()){
                const redemptionTxId = await BTCWatcher.completeAndSubmit(tx);
                this.redemptionState.state = redemptionState.completed;
                this.redemptionState.redemptionTxId = redemptionTxId;
                await this.redemptionDb.findOneAndUpdate({ index : this.redemptionState.index }, {$set: this.redemptionState}, {upsert: true});
                communicator.broadcast("updateRedemptionToComplete", {  index: this.redemptionState.index , tx: this.redemptionState.redemptionSignatures});

            }
        }catch(err){
            console.log("redemption signature error:", err);
        }
    }

    async checkBurn(){
        if(this.redemptionState.state === redemptionState.forged ){
            console.log("Checking burn", this.redemptionState.burningTransaction);
            if(await ADAWatcher.isBurnConfirmed(this.redemptionState.burningTransaction)){
                this.redemptionState.state = redemptionState.burned;
                await this.redemptionDb.findOneAndUpdate({ index : this.redemptionState.index }, {$set: this.redemptionState}, {upsert: true});
                return; 
            }

            if(communicator.amILeader()) {
                const quorum = ADAWatcher.getTxSigners(this.redemptionState.burningTransaction);
                if(communicator.checkAdaQuorum(quorum)){
                
                    console.log("Quorum healty, retrying signing burn");
                    communicator.broadcast("newRedemption", this.redemptionState);
                }else{
                    console.log("Quorum member offline, recreating redemption transaction");

                    let [mintRequests , redemptionRequests] = await ADAWatcher.queryValidRequests();

                    let [currentTransaction, requests] = await BTCWatcher.craftRedemptionTransaction(redemptionRequests);
                    await this.newRedemption(currentTransaction, requests);
                }
            }
            else{
                ADAWatcher.signBurn(this.redemptionState.burningTransaction);
            }

        }

        
        if(this.redemptionState.state === redemptionState.burned){
            const sig =  await BTCWatcher.signRedemptionTransaction(this.redemptionState.currentTransaction);
            if(communicator.amILeader()){
                this.redemptionState.redemptionSignatures = sig;
            }else{
                //sleep 2 sec and broadcast signature
                await new Promise((resolve) => setTimeout(resolve, 2000));
                communicator.leaderBroadcast("newRedemSignature", {sig, index:  this.redemptionState.index});
            }

            await this.redemptionDb.findOneAndUpdate({ index : this.redemptionState.index }, {$set: this.redemptionState}, {upsert: true});
            
        }
    }
 
    async checkRedemption(){
        console.log("Checking redemption");
        const redemptions = await this.redemptionDb.find({state : redemptionState.completed}).toArray();
        redemptions.forEach(async (redemption) => {
         if(await BTCWatcher.isTxConfirmed(this.redemptionState.redemptionTxId)){
            redemption.state = redemptionState.finalized;
            await this.redemptionDb.findOneAndUpdate({ index : redemption.index }, {$set: redemption}, {upsert: true});
            if(redemption.index === this.redemptionState.index){
                this.redemptionState = redemption;
            }
         }
        });
    }
    
    async checkPayments(){
        this.paymentPaths.forEach((path, index) => {
            let payment = BTCWatcher.getUtxosByIndex(index);
            if(path.state <= state.completed && payment.length > 0){
                payment.forEach(async (utxo) => {
                    if(await ADAWatcher.paymentProcessed(utxo.txid, utxo.vout)){
                        path.state = state.completed;
                        this.paymentPathsDb.findOneAndUpdate({ index }, { $set: this.paymentPaths[index] }, { upsert: true });
                    }
                });
            }


            if(path.state === state.finished && payment.length  === 0){
                path = {state: state.open, index: index , address: BTCWatcher.getAddress(index)};
                this.paymentPaths[index] = path;
                this.paymentPathsDb.deleteOne({ index });
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
                    this.paymentPathsDb.findOneAndUpdate({ index }, { $set: this.paymentPaths[index] }, { upsert: true });
                    ADAWatcher.completeMint(path.request.txHash, path.request.outputIndex, payment);
                }
            }
            
        });    
        this.consolidatePayments();
    }


    async consolidatePayments(){
        
        // if more than half of the payment paths are completed, consolidate the payments
        let completed = this.paymentPaths.filter((path) => path.state >= state.completed).map((path) => path.index);
        
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
        console.log("Consolidation check", threholdFilled, timeToConsolidate, maxWait, this.config.maxConsolidationTime, completed);
        if(threholdFilled || timeToConsolidate){
            console.log("Consolidating payments");
            await BTCWatcher.consolidatePayments(completed);
            completed.forEach((index) => {
                this.paymentPaths[index].state = state.finished;
                this.paymentPathsDb.findOneAndUpdate({ index }, { $set: this.paymentPaths[index] }, { upsert: true });
            });
        }else{
            console.log("Not consolidating payments", timeToConsolidate , threholdFilled);
        }
    }

}