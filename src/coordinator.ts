import { BTCWatcher  , ADAWatcher, communicator, coordinator } from "./index.js";
import EventEmitter from "events";
import { requestId } from "./helpers.js";
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
    redemptionDb: Collection<redemptionController>

    constructor( protocol: protocolConfig){
        this.config  = protocol
        this.redemptionDb = getDb(ADAWatcher.getDbName()).collection("redemptionState");
        this.paymentPathsDb = getDb(ADAWatcher.getDbName()).collection("paymentPaths");

        (async () => {
           
            this.paymentPaths = await Promise.all(
                Array.from({length: BTCWatcher.getPaymentPaths()}, (_, index) => index).map(async (index) => {
                    const paymentPath = await this.paymentPathsDb.findOne({index});
                    return paymentPath === null ? {state: state.open, index, address: BTCWatcher.getAddress(index)} : paymentPath; 
                })
        );

        })();
        this.getOpenRequests = this.getOpenRequests.bind(this);
        this.onNewCardanoBlock = this.onNewCardanoBlock.bind(this); 
       

    }

    async getCurrentRedemption() : Promise<Array<redemptionController>> {
        const latest = await this.redemptionDb.find().sort({ index: -1 }).limit(1).toArray();
        if(latest.length === 0) return [];
        const documents  = await this.redemptionDb.find({ index: latest[0].index }).sort({ alternative: -1 }).toArray();
        //remove _id from documents
        documents.forEach((document) => {
            delete document._id;
        });
        return documents.length === 0 ? [] : documents;
    }

    async getFoundRedemptions() : Promise<Array<redemptionController>> {
        return await this.redemptionDb.find({ state : redemptionState.found }).toArray();
    }

    async getRedemptionState(currentTransaction: string) : Promise<redemptionController>{
        return this.redemptionDb.findOne({ currentTransaction , state: redemptionState.finalized } );
    }
    
    async getOpenRequests(){
        let [mintRequests , redemptionRequests] = await ADAWatcher.queryValidRequests();
        
        console.log("Checking requests", mintRequests, redemptionRequests);

        //console.log("Mint Requests", mintRequests);
        //console.log("Redemption Requests", redemptionRequests);
        this.paymentPaths.forEach( (paymentPath, index) => {
            const utxos = BTCWatcher.getUtxosByIndex(paymentPath.index);
            if(paymentPath.state === state.commited && mintRequests.find((mintRequest) => requestId(mintRequest) === requestId(paymentPath.request)) === undefined && utxos.length === 0){
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
            if(this.paymentPaths[index] === undefined){
                console.log("Invalid payment path, rejecting request");
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

        if (redemptionRequests.length > 0 ) {
            const redemptions = await this.getCurrentRedemption();
            const redemptionAvaiable = redemptions.length === 0 || redemptions.some((redemption) => [ redemptionState.finalized , redemptionState.found].includes(redemption.state));
            console.log("Redemption available", redemptionAvaiable, redemptions.length === 0, redemptions.some((redemption) => [ redemptionState.finalized , redemptionState.found].includes(redemption.state) ));
            if(redemptionAvaiable){
                try {
                    if(communicator.amILeader()){
                        let [currentTransaction, requests] = await BTCWatcher.craftRedemptionTransaction(redemptionRequests);
                        await this.newRedemption(currentTransaction, requests);
                    }else{
                        communicator.sendToLeader("queryRedemption");
                    }
                } catch (e) {
                    console.log("Error crafting redemption transaction", e);
                }
            }else {
                if(this.payByChildTime(redemptions) && communicator.amILeader()){
                    console.log("Redemption timed out, using Pay by Child");
                    const completedRedemption = redemptions.find((redemption) => redemption.state === redemptionState.completed);

                    let [currentTransaction, requests] = await BTCWatcher.craftRedemptionTransaction(redemptionRequests, completedRedemption.redemptionTx);
                    await this.newRedemption(currentTransaction, requests);
                }
            }
        }
        
    }


    payByChildTime(redemptions: redemptionController[]): boolean{
        const completedRedemption = redemptions.find((redemption) => redemption.state === redemptionState.completed);
        return completedRedemption !== undefined && completedRedemption.completedTime !== undefined && Date.now() - completedRedemption.completedTime > this.config.redemptionTimeoutMinutes * 60000;
    }

    async checkTimeout(){
        this.paymentPaths.forEach((path, index) => {
            if (path.state === state.commited && Date.now() - path.openTime > this.config.mintTimeoutMinutes * 60000){
                console.log("Payment path timed out");
                ADAWatcher.confescateDeposit(path.request.txHash, path.request.outputIndex);
            }
        });
        
    }

    async completeFoundRedemption(data: redemptionController) {
        try{
            const redemption = await this.redemptionDb.findOne({ currentTransaction : data.currentTransaction });
            if(redemption === null) throw new Error("Redemption not found");
            if(redemption.state !== redemptionState.found) throw new Error("Redemption not in found state");
            if(data.state !== redemptionState.finalized) throw new Error("Redemption not in finalized state");
            if(data.burningTransaction.txId !== redemption.burningTransaction.txId) throw new Error("Burn transaction does not match");   
            if(data.currentTransaction !== redemption.currentTransaction) throw new Error("Redemption transaction does not match");

            const redemptionOk = BTCWatcher.checkFinalizedRedemptionTx(data);
            if (!redemptionOk) throw new Error("Redemption transaction is not valid");


            const cleanData = data
            delete cleanData["_id"];
            delete cleanData["index"];
            delete cleanData["alternative"];
            
            await this.redemptionDb.findOneAndUpdate({ currentTransaction : data.currentTransaction , state : redemptionState.found }, { $set: data });
       
        }catch(e){
            console.log("Error completing found redemption", e);
        }
    }

    async importRedemption(newRedemptionState: redemptionController){
        try{
            const redemptions = await this.getCurrentRedemption();
            const currentRedemptionState = redemptions[0]
            console.log("Importing redemption", newRedemptionState);
            const redemptionOk = BTCWatcher.checkRedemptionTx(newRedemptionState.currentTransaction, newRedemptionState.burningTransaction.tx);
            if (!redemptionOk) throw new Error("Redemption transaction is not valid");
            
            if(redemptions.length !== 0){

                if (currentRedemptionState.state === redemptionState.found){ 
                    if (currentRedemptionState.currentTransaction === newRedemptionState.currentTransaction){
                        console.log("Found redemption already exists, updating to forged");
                        await this.redemptionDb.findOneAndUpdate({ index : currentRedemptionState.index, alternative: currentRedemptionState.alternative  }, { $set: newRedemptionState });
                        return;
                    }else{
                        if(newRedemptionState.index === currentRedemptionState.index + 1) {
                            await this.redemptionDb.findOneAndUpdate({ index : newRedemptionState.index, alternative: newRedemptionState.alternative  }, { $set: newRedemptionState }, { upsert: true });
                            communicator.sendToLeader("updateRequest", currentRedemptionState.currentTransaction);
                        }
                    }
                }
                
                if(newRedemptionState.index === currentRedemptionState.index + 1) {
                    if(!redemptions.some(redemption => (redemption.state === redemptionState.finalized)) && !this.payByChildTime(redemptions)  ) throw new Error("Redemption already in progress");
                }else if(newRedemptionState.index === currentRedemptionState.index && newRedemptionState.alternative !== currentRedemptionState.alternative +1 ) {
                    if(currentRedemptionState.state === redemptionState.forged){
                        if ( communicator.checkAdaQuorum(ADAWatcher.getTxSigners(currentRedemptionState.burningTransaction.tx) )){
                            throw new Error("Redemption already forged, waiting for burn signatures");
                    }
                }

            }
        }

        //remove _id 
        await this.redemptionDb.findOneAndUpdate({ index : newRedemptionState.index , alternative : newRedemptionState.alternative}, { $set: newRedemptionState }, { upsert: true });
        }catch(e){
            console.log("Error in importing redemption", e);
        }
    }

    async newRedemption(currentTransaction: Psbt ,redemptionRequests: redemptionRequest[]) {
        console.log("Staring New redemption")
        try {
            const currentRedemptions = await this.getCurrentRedemption();
            const [burnTx, signature ] = (await ADAWatcher.burn(redemptionRequests, currentTransaction.toHex()))
            const redemptionOk = BTCWatcher.checkRedemptionTx(currentTransaction.toHex(), burnTx.toCBOR());
            if(!redemptionOk) throw new Error("Redemption transaction is not valid");
        

            let index = 0;
            let alternative = 0;
  
            if(currentRedemptions.length !== 0 && this.payByChildTime(currentRedemptions)){
                index = currentRedemptions[0].index;
                if(currentRedemptions[0].state === redemptionState.forged){ 
                if ( communicator.checkAdaQuorum(ADAWatcher.getTxSigners(currentRedemptions[0].burningTransaction.tx) )){
                    throw new Error("Redemption already forged, waiting for burn signatures");
                }else{
                        console.log("Quorum not met, recreating redemption transaction");
                        alternative = 1 +  currentRedemptions[0].alternative;
                }
            }else if(currentRedemptions[0].state === redemptionState.found){
                if(currentRedemptions[0].currentTransaction === currentTransaction.toHex()) {
                    console.log("Redemption found, updating to forged");
                }else {
                    index += 1;
                }
                
            }else{
                index += 1;
                if (currentRedemptions[0].state !== redemptionState.finalized && !this.payByChildTime(currentRedemptions) ) throw new Error("Redemption already in progress");
            }
            
            }

        const newRedemptionState : redemptionController = {
                index: index,
                alternative: alternative,
                state: redemptionState.forged,
                currentTransaction: currentTransaction.toHex(),
                burningTransaction: {
                    tx : burnTx.toCBOR(),
                    txId: burnTx.toHash(),
                    signatures: [signature],
                },
           };

             
            await this.redemptionDb.findOneAndUpdate({ index : index, alternative: alternative  }, { $set: newRedemptionState }, { upsert: true });
            if(communicator.amILeader) communicator.broadcast("newRedemption", newRedemptionState);
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
        return  Math.round(Number(request.assets[cBtcId])  - this.config.fixedFee - this.config.redemptionMargin *  Number(request.assets[cBtcId]));
    }

    getPaymentPaths(){  
        return this.paymentPaths;
    }

    async onNewCardanoBlock(){
    try{
            console.log("New Cardano Block event");
        if(BTCWatcher.inSync() === false || ADAWatcher.inSync() === false) return;
        await this.getOpenRequests(); 
        await this.checkTimeout(); 
        await this.checkBurn(); 
        await this.checkPayments()
            await this.completeRedemption();
        }catch(e){
            console.log("Error in onNewCardanoBlock", e);
        }
    }

    async onNewBtcBlock(){
        if (BTCWatcher.inSync() === false || ADAWatcher.inSync() === false) return;
        console.log("New BTC Block event");       
        this.checkPayments() 
        this.checkRedemption();
    }

    async getBurnTx(){
        return (await this.getCurrentRedemption())[0].burningTransaction.tx ;
    }

    async newBurnSignature(signature: string){
            const redemptionStates = await this.getCurrentRedemption();
            console.log("New burn signature", signature , redemptionStates);
            if(redemptionStates.length === 0) return;
           for(const redemption of redemptionStates) {
                const burnTx =  ADAWatcher.txCompleteFromString(redemption.burningTransaction.tx);     
                    const signatureInfo = ADAWatcher.decodeSignature(signature);
                    if (!signatureInfo.witness.vkeywitnesses().get(0).vkey().verify( Buffer.from(burnTx.toHash(), 'hex'), signatureInfo.witness.vkeywitnesses().get(0).ed25519_signature())){
                        console.log("Invalid signature");
                        throw new Error("Invalid signature for Cardano transaction txId: " + burnTx.toHash() + " type: Burn" );
                    }
        
                if(redemption.state !== redemptionState.forged) return;
        
                if(!redemption.burningTransaction.signatures.includes(signature)) 
                    redemption.burningTransaction.signatures.push(signature);
        
                if(redemption.burningTransaction.signatures.length >= BTCWatcher.getM()){ 
                    const burnTx =  ADAWatcher.txCompleteFromString(redemption.burningTransaction.tx);     
                    const completedTx = (await burnTx.assemble(redemption.burningTransaction.signatures).complete())
                    ADAWatcher.submitTransaction(completedTx);
                    console.log("Burn signatures complete", burnTx);
                }
            } ;
    }

    async updateRedemptionToComplete(data: { tx: string}){
    try{
        const redemption = await this.redemptionDb.findOne({ state : redemptionState.burned });
        
        const psbt = BTCWatcher.psbtFromHex(data.tx);

        if(BTCWatcher.txEqual(redemption.currentTransaction, data.tx) && redemption.state === redemptionState.burned ){
            console.log("Redemption finalized, updating to completed"); 
        //    if (psbt.data.inputs[0].partialSig.length !== BTCWatcher.getM()) throw new Error("Redemption not fully signed");
        //    if (!psbt.data.inputs.every(input => input.finalScriptSig || input.finalScriptWitness)) throw new Error("Not all inputs are finalized");
           
            redemption.redemptionSignatures = data.tx;
            redemption.redemptionTxId = psbt.extractTransaction().getId();
            redemption.redemptionTx = psbt.toHex();
            redemption.state = redemptionState.completed;
            redemption.completedTime = Date.now();
            this.redemptionDb.findOneAndUpdate({ index : redemption.index , alternative : redemption.alternative }, {$set: redemption});

            this.checkRedemption();
        }
        }catch(err){
            console.log("Error updating redemption to complete", err);
        }
    }

    async newRedemptionSignature(signature: string){
        const redemption = await this.redemptionDb.findOne({ state : redemptionState.burned });
        console.log("New redemption signature", signature , redemption);

        if(redemption === null) {
            const completedRedemption = await this.redemptionDb.findOne({ state :  redemptionState.completed });
            if(completedRedemption !== null)
                communicator.broadcast("updateRedemptionToComplete", {  tx: completedRedemption.redemptionTx});
            else{
                const finalizedRedemption = await this.redemptionDb.find({ state :  redemptionState.finalized }).sort({ index: -1 }).limit(1).toArray();
                finalizedRedemption.forEach((redemption) => {
                    if( BTCWatcher.txEqual(redemption.redemptionSignatures, signature)){
                        communicator.broadcast("updateRedemptionToComplete", {  tx: redemption.redemptionTx});
                        return;
                    }
                });

            }
            return ;
        }
        
        let psbt = BTCWatcher.psbtFromHex(redemption.redemptionSignatures)

        if (!(psbt.data.inputs[0].partialSig.length >= BTCWatcher.getM())) {
            const tx = BTCWatcher.combine(psbt, signature);
            redemption.redemptionSignatures = tx.toHex();
            await this.redemptionDb.findOneAndUpdate({ index : redemption.index ,alternative : redemption.alternative  }, {$set: redemption});
            psbt = tx;
        }

        if(psbt.data.inputs[0].partialSig.length >= BTCWatcher.getM()){
            psbt.finalizeAllInputs();
            const redemptionTxId = await BTCWatcher.completeAndSubmit(psbt);
            redemption.state = redemptionState.completed;
            redemption.redemptionTxId = redemptionTxId;
            redemption.redemptionTx = psbt.toHex();
            await this.redemptionDb.findOneAndUpdate({ index : redemption.index, alternative : redemption.alternative }, {$set: redemption});
            communicator.broadcast("updateRedemptionToComplete", {  tx: redemption.redemptionTx});

        }

    }

    async loadBurn(tx , block , redemptionTx: string){

        console.log("Loading burn", tx.toJson(),  redemptionTx);   
        const listing = await this.redemptionDb.findOne({ currentTransaction : redemptionTx });
        if(listing === null){
            const redemptions = await this.getCurrentRedemption();
            let  index : number
            let  alternative : number
            if(redemptions.length === 0){
                index = 0;
                alternative = 0;
            }else{
                index = redemptions[0].index+1;
                alternative = redemptions[0].alternative ;
            }
            const redemption : redemptionController = {
                index,
                alternative: alternative,
                state: redemptionState.found,
                currentTransaction: redemptionTx,
                burningTransaction: {
                    tx: "",
                    txId:  Buffer.from(tx.hash).toString('hex'),
                    signatures: []
                }
            }
            await this.redemptionDb.findOneAndUpdate({ index , alternative}, {$set: redemption}, {upsert: true});
            await this.redemptionDb.updateOne({  state : redemptionState.completed }, { $set: { state: redemptionState.found } });
            await this.redemptionDb.updateOne({  state : redemptionState.burned }, { $set: { state: redemptionState.found } });
        }

    }

    async checkBurn(){
        let redemptions = await this.getCurrentRedemption();
        if(redemptions.length === 0) return;

        redemptions.map(async (redemption) => {
            if(redemption.state !== redemptionState.forged) return;
            if(await ADAWatcher.isBurnConfirmed(redemption.burningTransaction.txId)){
                    await this.redemptionDb.findOneAndUpdate({ index : redemption.index, alternative : redemption.alternative }, {$set:  { state: redemptionState.burned }}, {upsert: true});
                    await this.redemptionDb.updateMany({ index : redemption.index, state : redemptionState.forged  }, { $set: { state: redemptionState.cancelled } });
                    this.checkRedemption();
                    return; 
                }
            
      
        });

        redemptions = await this.getCurrentRedemption();
        if(redemptions[0].state === redemptionState.forged){
            if(communicator.amILeader()) {
                const quorum = ADAWatcher.getTxSigners(redemptions[0].burningTransaction.tx);
                if(communicator.checkAdaQuorum(quorum)){
                
                    console.log("Quorum healty, retrying signing burn");
                    communicator.broadcast("newRedemption", redemptions[0]);
                }else{
                    console.log("Quorum member offline, recreating redemption transaction");

                    let [mintRequests , redemptionRequests] = await ADAWatcher.queryValidRequests();

                    let [currentTransaction, requests] = await BTCWatcher.craftRedemptionTransaction(redemptionRequests);
                    await this.newRedemption(currentTransaction, requests);
                }
            }else{
                ADAWatcher.signBurn(redemptions[0].burningTransaction.tx);
            }
        }
    }
 
    async completeRedemption(){
        const burnedRedemption = await this.redemptionDb.findOne({ state : redemptionState.burned });

        if(burnedRedemption !== null){
            const sig =  await BTCWatcher.signRedemptionTransaction(burnedRedemption.currentTransaction);
            if(communicator.amILeader()){ 
                if( burnedRedemption.redemptionSignatures === undefined)
                    await this.redemptionDb.findOneAndUpdate({ index : burnedRedemption.index , alternative : burnedRedemption.alternative }, {$set: {redemptionSignatures : sig} });
            }else{
                //sleep 2 sec and broadcast signature
                await new Promise((resolve) => setTimeout(resolve, 2000));
                communicator.sendToLeader("newRedemSignature", {sig});
            } 
            }   

    }

    async checkRedemption(){
        

        console.log("Checking redemption");

        const redemptions = await this.redemptionDb.find({state : redemptionState.completed}).toArray();


        redemptions.forEach(async (redemption) => {
         if(await BTCWatcher.isTxConfirmed(redemption.redemptionTxId)){

            await this.redemptionDb.findOneAndUpdate({ state : redemptionState.completed  }, {$set: {state : redemptionState.finalized}});
          
         }
        });
    }
    
    async checkPayments(){
        this.paymentPaths.forEach(async (path, index) => {
            let payment = BTCWatcher.getUtxosByIndex(index);
            if(path.state <= state.completed && payment.length > 0){
                payment.forEach(async (utxo) => {
                    if(await ADAWatcher.paymentProcessed(utxo.txid, utxo.vout)){
                        path.state = state.completed;
                        this.paymentPathsDb.findOneAndUpdate({ index }, { $set: this.paymentPaths[index] }, { upsert: true });
                    }
                });
            }


            if(path.state >= state.completed && payment.length  === 0){
                path = {state: state.open, index: index , address: BTCWatcher.getAddress(index)};
                this.paymentPaths[index] = path;
                this.paymentPathsDb.deleteOne({ index });
            }
         
            if (path.state === state.commited && payment.length > 0){
                const height = await BTCWatcher.getHeight();
                let sum = BTCWatcher.btcToSat(payment.reduce((acc, utxo) => height >= utxo.height + this.config.finality.bitcoin ? acc + utxo.amount : acc, 0));
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
                    // this.paymentPathsDb.findOneAndUpdate({ index }, { $set: this.paymentPaths[index] }, { upsert: true });
                    // ADAWatcher.completeMint(path.request.txHash, path.request.outputIndex, payment);
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