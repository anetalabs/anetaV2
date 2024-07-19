import { Db } from "mongodb";
import { toHexString, txId,  hexToString } from "./helpers.js";
import * as Lucid  from 'lucid-cardano'
import { CardanoSyncClient , CardanoBlock } from "@utxorpc/sdk";
import {MetadatumArray} from  "@utxorpc/spec/lib/utxorpc/v1alpha/cardano/cardano_pb.js";
import {cardanoConfig, secretsConfig, mintRequest , MintRequestSchema, RedemptionRequestSchema, utxo, redemptionRequest, protocolConfig} from "./types.js"
import {emitter}  from "./coordinator.js";
import axios from "axios";
import { getDb } from "./db.js";
import {  BTCWatcher, communicator, coordinator } from "./index.js";

export const METADATA_TAG = 85471236584;

export class CardanoWatcher{
    private mongo: Db;
    private utxos : Lucid.UTxO[] = [];
    private lucid: Lucid.Lucid;
    private mintingScript: Lucid.Script;
    private syncing: boolean = true;
    private cBTCPolicy: Lucid.PolicyId;
    private cBtcHex: string;
    private address: string;
    private myKeyHash: string;
    private configUtxo : Lucid.UTxO;
    private config: cardanoConfig;
    private redemptionRequests: redemptionRequest[] = [];   
    private rejectionQueue: {txHash: string, index: number , targetAddress : string , completed: Date | undefined , created: Date}[] = [];
    private confescationQueue: {txHash: string, index: number ,  completed: Date | undefined , created: Date}[] = [];
    private mintQueue: {txHash: string, index: number , targetAddress : string , completed: Date | undefined , created: Date}[] = [];
    private burnQueue: {txHash: string, index: number , completed: Date | undefined , created: Date }[] = [];

    constructor(config: cardanoConfig, secrets: secretsConfig, prorocolConfig: protocolConfig){

        this.mongo = getDb(config.DbName)
        console.log(typeof this.mongo)
        this.mintingScript = {type: "PlutusV2" , script: prorocolConfig.contract};
        this.queryValidRequests = this.queryValidRequests.bind(this);


        this.config = config;

        (async () => {

           this.lucid = await Lucid.Lucid.new(new Lucid.Blockfrost(config.lucid.provider.host, config.lucid.provider.projectId), (config.network.charAt(0).toUpperCase() + config.network.slice(1)) as Lucid.Network);
           this.lucid.selectWalletFromSeed(secrets.seed);
           console.log("Minting Script Address:", this.mintingScript);
           emitter.emit("notification", "Cardano Watcher Ready");
           this.cBTCPolicy = this.lucid.utils.mintingPolicyToId(this.mintingScript);
           console.log("Minting PolicyId:", this.cBTCPolicy);
           this.cBtcHex = "63425443";
           console.log(prorocolConfig.adminToken);
           this.configUtxo = await this.lucid.provider.getUtxoByUnit(prorocolConfig.adminToken);
           this.address =  this.lucid.utils.credentialToAddress({type: "Script", hash: this.cBTCPolicy});
           this.myKeyHash = this.lucid.utils.getAddressDetails(await this.lucid.wallet.address()).paymentCredential.hash;
           console.log("Address", this.address);
           console.log("Local Address", await this.lucid.wallet.address());    
            await this.dumpHistory();
            this.startIndexer();
        })();
        
        console.log("cardano watcher")
    }


    getDbName() : string{
      return  this.config.DbName;
    }

    async getAddress() : Promise<Object>{
        const localAddress = await this.lucid.wallet.address()
        return { "Prorocol Address" : this.address, "local address" : localAddress};
       
    }

    async submitTransaction(tx: Lucid.TxSigned){
        //this.lucid.provider.submitTx(tx.toString());
        console.log("Submitting: ", tx.toString());
        try{
           // await this.lucid.provider.submitTx(tx.toString());
            await axios.post("https://cardano-preprod.blockfrost.io/api/v0/tx/submit", Buffer.from(tx.toString(), 'hex'), {headers: {"project_id": this.config.lucid.provider.projectId, "Content-Type": "application/cbor"}})   
        }catch(e){
            console.log(e);
            emitter.emit("submitionError", e);
        }
    }


    async signBurn(txHex : string){
        const tx = this.txCompleteFromString(txHex)
        const signature =  (await this.lucid.wallet.signTx( tx.txComplete)).to_bytes().reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
        console.log("Signature", signature);
        communicator.sendToLeader( "burnSignature" , signature.toString());
    }

    async burn(requests: redemptionRequest[], redemptionTx: string) : Promise< [Lucid.TxComplete , string]>{
        const splitIntoChunks = (str, chunkSize) => {
            const chunks = [];
            for (let i = 0; i < str.length; i += chunkSize) {
                chunks.push(str.substring(i, i + chunkSize));
            }
            return chunks;
        };
        
        try{
            if(communicator.amILeader()){
                const MultisigDescriptorSchema = Lucid.Data.Object({ 
                    list: Lucid.Data.Array(Lucid.Data.Bytes()),
                    m: Lucid.Data.Integer(),
                    });
                    
                const metadata = splitIntoChunks(redemptionTx, 64);

                type MultisigDescriptor = Lucid.Data.Static<typeof MultisigDescriptorSchema>;
                const MultisigDescriptor = MultisigDescriptorSchema as unknown as MultisigDescriptor; 
                
                console.log("Config UTxO",this.configUtxo)
                const multisig = Lucid.Data.from(this.configUtxo.datum, MultisigDescriptor);
                console.log(multisig);
                const openRequests =await this.lucid.provider.getUtxos(this.address);
                const request = requests;
                console.log(request)
                
                const spendingTx =  this.lucid.newTx().attachSpendingValidator(this.mintingScript).collectFrom(requests, Lucid.Data.void()).readFrom([this.configUtxo])
                const quorum = communicator.getQuorum();
                
                const signersTx = this.lucid.newTx()
                
                quorum.forEach((signer) => {
                    signersTx.addSigner(signer);
                });

                
                const referenceInput = this.lucid.newTx().readFrom([this.configUtxo]);
                const assets = {} 
                assets[this.cBTCPolicy + this.cBtcHex] = -requests.reduce((acc, request) => acc + Number(request.assets[this.cBTCPolicy +  this.cBtcHex]) , 0);
                const mintTx = this.lucid.newTx().attachMintingPolicy(this.mintingScript).mintAssets(assets, Lucid.Data.void()).attachMetadata(METADATA_TAG, metadata);
                // 4 hours later than now f


                const ttl = this.lucid.newTx().validTo(new Date().getTime() + 14400000);
            
            
                const finalTx = this.lucid.newTx()
                                        .compose(signersTx)
                                        .compose(spendingTx)
                                        .compose(mintTx)
                                        .compose(referenceInput)
                                        .compose(ttl);
        
                const completedTx = await finalTx.complete({change: { address: coordinator.getConfig().adminAddress },  coinSelection : false});
                const signature = await  completedTx.partialSign();
                // const signedTx = await completedTx.assemble([signatures]).complete();
                // console.log("signature", signatures);
                // console.log("completedTx", signedTx.toString());
                // return await signedTx.submit();    
                return [completedTx ,signature ]
                
            }else{
                requests.forEach(request => {
                    this.burnQueue.push({txHash: request.txHash, index: request.outputIndex , completed : undefined, created: new Date()} );                
                });
            }
        }catch(e){
                console.log(e);
            }
    }

    
    decodeTransaction(tx : Lucid.TxComplete) : [any, Lucid.C.Transaction]{
        const uint8Array = new Uint8Array(tx.toString().match(/.{2}/g).map(byte => parseInt(byte, 16)));
        const cTx = Lucid.C.Transaction.from_bytes(uint8Array);
        const txBody = cTx.body().to_js_value()
        
        return [txBody, cTx];
        
    }
    
    decodeSignature(signature: string) : {signature: string, signer: string, witness: Lucid.C.TransactionWitnessSet} {
    try{
        const uint8Array = new Uint8Array(signature.match(/.{2}/g).map(byte => parseInt(byte, 16)));
        const witness  =  Lucid.C.TransactionWitnessSet.from_bytes(uint8Array)
        const signer = witness.vkeys().get(0).vkey().public_key().hash().to_hex();
        return {signature, signer: signer , witness : witness}     
    
      }catch(e){
        console.log("Error Decoding Signature", e);     
      } 
    }

    requestId(request: Lucid.UTxO){
        return request.txHash + request.outputIndex.toString();
    }
    
    async signReject(tx : {tx: Lucid.TxComplete , txId: string}){
        const [txDetails, cTx] = this.decodeTransaction(tx.tx);
        // check the rejection queue for the request
        let requestTxHash = txDetails.inputs[0].transaction_id;
        let requestIndex = Number(txDetails.inputs[0].index);
        console.log("Signing Rejection", requestTxHash, requestIndex, txDetails, this.rejectionQueue);
        const requestListing = this.rejectionQueue.find((request) => request.txHash === requestTxHash && request.index === requestIndex);
        if(!requestListing) throw new Error("Request not found in rejection queue");
        const amIaSigner = txDetails.required_signers.some(async (signature : string) => signature === this.myKeyHash);
        if(!amIaSigner) throw new Error("Not a signer for this request");
        const mintClean = txDetails.mint === null;
        const inputsClean = (txDetails.inputs.length === 1 && txDetails.inputs[0].transaction_id === requestTxHash && Number(txDetails.inputs[0].index) === requestIndex); 
        const outputsClean = txDetails.outputs.length === 1 && txDetails.outputs[0].address === requestListing.targetAddress ;
        const withdrawalsClean = txDetails.withdrawals === null;
        
        console.log(mintClean, inputsClean, outputsClean, withdrawalsClean , txDetails, !requestListing.completed)
        if (requestListing && mintClean && inputsClean && outputsClean && withdrawalsClean){
            const signature =  (await this.lucid.wallet.signTx(cTx)).to_bytes().reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
            console.log("Signature", signature);
            communicator.signatureResponse({txId : tx.txId , signature});
            //update the rejection queue to reflect that the request has been signed
            requestListing.completed = new Date();
            
        }
        }
        

    async rejectRequest(txHash: string, index: number){
        console.log("Rejecting Request", txHash, index);
        if(communicator.amILeader()){
            try{
                const quorum = communicator.getQuorum();
             
                

                const openRequests =await this.lucid.provider.getUtxos(this.address);
                const request = openRequests.find( (request) => request.txHash === txHash && request.outputIndex === index);
                const spendingTx =  this.lucid.newTx().attachSpendingValidator(this.mintingScript).collectFrom([request], Lucid.Data.void() ).readFrom([this.configUtxo])
                
                
                const signersTx = this.lucid.newTx()
                
                quorum.forEach((signer) => {
                    signersTx.addSigner(signer);
                });

                
                const referenceInput = this.lucid.newTx().readFrom([this.configUtxo]);
                
                const finalTx = this.lucid.newTx()
                .compose(signersTx)
                .compose(spendingTx)
                
                .compose(referenceInput);
                
                try{
                    const tx = await finalTx.complete({change: { address: await this.getUtxoSender(txHash, index)},  coinSelection : false});
                    const signature = await  tx.partialSign();
                    communicator.cardanoTxToComplete({type: "rejection", txId : tx.toHash(), signatures: [signature] , tx, status: "pending"});
                }catch(e){
                    console.log("transaction building error:", e);
                }
        }catch(e){
            console.log(e);
        }       
        
    }else{
        this.rejectionQueue.push({txHash, index , targetAddress: await this.getUtxoSender(txHash, index), completed : undefined, created: new Date()} );                
    } 

    }

    async signConfescation(tx : {tx: Lucid.TxComplete , txId: string}){
        const [txDetails, cTx] = this.decodeTransaction(tx.tx);
        // check the rejection queue for the request
        let requestTxHash = txDetails.inputs[0].transaction_id;
        let requestIndex = Number(txDetails.inputs[0].index);
        const requestListing = this.confescationQueue.find((request) => request.txHash === requestTxHash && request.index === requestIndex);
        if(!requestListing) throw new Error("Request not found in rejection queue");
        const amIaSigner = txDetails.required_signers.some(async (signature : string) => signature === this.myKeyHash);
        if(!amIaSigner) throw new Error("Not a signer for this request");
        const mintClean = txDetails.mint === null;
        const inputsClean = (txDetails.inputs.length === 1 && txDetails.inputs[0].transaction_id === requestTxHash && Number(txDetails.inputs[0].index) === requestIndex); 
        const outputsClean = txDetails.outputs.length === 1 && txDetails.outputs[0].address === coordinator.config.adminAddress ;
        const withdrawalsClean = txDetails.withdrawals === null;
        
        console.log(mintClean, inputsClean, outputsClean, withdrawalsClean , txDetails, !requestListing.completed)
        if (requestListing && mintClean && inputsClean && outputsClean && withdrawalsClean){
            const signature =  (await this.lucid.wallet.signTx(cTx)).to_bytes().reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
            console.log("Signature", signature);
            communicator.signatureResponse({txId : tx.txId , signature});
            //update the rejection queue to reflect that the request has been signed
            requestListing.completed = new Date();
            
        }
     }
    


    async confescateDeposit(txHash: string, index: number){
        console.log("Confescating Deposit", txHash, index);
        if(communicator.amILeader()){
            try{
                const quorum = communicator.getQuorum();
       
                const openRequests =await this.lucid.provider.getUtxos(this.address);
                const request = openRequests.find( (request) => request.txHash === txHash && request.outputIndex === index);
                console.log(request)
                const spendingTx =  this.lucid.newTx().attachSpendingValidator(this.mintingScript).collectFrom([request], Lucid.Data.void() ).readFrom([this.configUtxo])
                
                
                const signersTx = this.lucid.newTx()
                
                quorum.forEach((signer) => {
                    signersTx.addSigner(signer);
                });

                
                const referenceInput = this.lucid.newTx().readFrom([this.configUtxo]);
                
                const finalTx = this.lucid.newTx()
                .compose(signersTx)
                .compose(spendingTx)
                .compose(referenceInput);
                
                try{
                    const tx = await finalTx.complete({change: { address: coordinator.config.adminAddress},  coinSelection : false});
                    const signature = await  tx.partialSign();
                    communicator.cardanoTxToComplete({type: "confescation", txId : tx.toHash(), signatures: [signature] , tx, status: "pending"});
                }catch(e){
                    console.log("transaction building error:", e);
                }
        }catch(e){
            console.log(e);
        }
        }else{
            this.confescationQueue.push({txHash, index , completed : undefined, created: new Date()} );
        }
    }
    
    async checkMedatada(data_hash: string, metadata: any){
        const tmpTx = this.lucid.newTx().attachMetadata(METADATA_TAG, metadata).collectFrom(await this.lucid.wallet.getUtxos()).payToAddress(await this.lucid.wallet.address(), {"lovelace": BigInt(1)});
         const tmpTxComplete = await tmpTx.complete({  coinSelection : false});
         const [txDetails, cTx] = this.decodeTransaction(tmpTxComplete);
        return txDetails.auxiliary_data_hash === data_hash;
    }

    

    async signMint(tx : {tx: Lucid.TxComplete, txId : string , metadata: [string, number][]}){
        try{
            const [txDetails, cTx] = this.decodeTransaction(tx.tx);
            console.log("Signing Mint", JSON.stringify(txDetails));
            let requestTxHash = txDetails.inputs[0].transaction_id;
            let requestIndex = Number(txDetails.inputs[0].index);
            if(! await this.checkMedatada(txDetails.auxiliary_data_hash, tx.metadata)) throw new Error("Invalid Metadata");
            const requestListing = this.mintQueue.find((request) => request.txHash === requestTxHash && request.index === requestIndex);
            if(!requestListing)  throw new Error("Request not found in mint queue");

            const openRequests =await this.lucid.provider.getUtxos(this.address);
            const request = openRequests.find( (request) => request.txHash === requestTxHash  && request.outputIndex ===  requestIndex) as mintRequest;
            request.decodedDatum = this.decodeDatum(request.datum);
            const utxos = BTCWatcher.getUtxosByIndex(request.decodedDatum .path)

            let total = 0;
            for(let payment of  tx.metadata){
                console.log("Checking Payment", payment)
                if(await this.paymentProcessed(payment[0], Number(payment[1]))){
                    throw new Error("Payment already processed");
                }
                if(!utxos.some((utxo) => utxo.txid === payment[0] && utxo.vout === payment[1])){
                    throw new Error("Payment not found in UTXO set");
                }
                total += utxos.find((utxo) => utxo.txid === payment[0] && utxo.vout === payment[1]).amount;
            }
            
            
            const amIaSigner = txDetails.required_signers.some(async (signature : string) => signature === this.myKeyHash);
            if(!amIaSigner) return;

            const mintClean = Object.keys(txDetails.mint).length === 1  &&   Object.keys(txDetails.mint[this.cBTCPolicy]).length === 1 &&  Number(txDetails.mint[this.cBTCPolicy][this.cBtcHex]) === Number( (request.decodedDatum.amount)) ; //metadata.amount;
            const inputsClean = (txDetails.inputs.length === 1 && txDetails.inputs[0].transaction_id === requestTxHash && Number(txDetails.inputs[0].index) ===  requestIndex);

            txDetails.outputs.forEach((output) => {
                if (output.address !== requestListing.targetAddress)
                throw new Error("Invalid Output Address");
            });
            const withdrawalsClean = txDetails.withdrawals === null;
            const paymentComplete = Number(BTCWatcher.btcToSat(total)) >= Number( coordinator.calculatePaymentAmount(request, utxos.length));
            console.log(mintClean, inputsClean,  withdrawalsClean , !requestListing.completed,  coordinator.calculatePaymentAmount(request, utxos.length), paymentComplete,request.decodedDatum.amount , total)
            if (!requestListing.completed && mintClean && inputsClean &&  withdrawalsClean && paymentComplete ){
                const signature =  (await this.lucid.wallet.signTx(cTx)).to_bytes().reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
                console.log("Signature", signature);
                communicator.signatureResponse({txId: tx.txId , signature});
                //update the mint queue to reflect that the request has been signed
                requestListing.completed = new Date();
            }
        }catch(e){
            console.log("Error Signing Mint", e);
        }
    }
    
    async completeMint(txHash: string, index: number, payments: utxo[]){
        if(communicator.amILeader()){
        try{
            const quorum = communicator.getQuorum();

            for(let payment of payments){
                console.log("Payment", payment);
                if(await this.paymentProcessed(payment.txid, payment.vout)){
                    throw new Error("Payment already processed");
                }
            }
            // check that we are synced with the tip
            const MultisigDescriptorSchema = Lucid.Data.Object({ 
                list: Lucid.Data.Array(Lucid.Data.Bytes()),
                m: Lucid.Data.Integer(),
                });
                
                
            const metadata = payments.map((payment) => {
                return [ payment.txid , payment.vout];
             });
            type MultisigDescriptor = Lucid.Data.Static<typeof MultisigDescriptorSchema>;
            const MultisigDescriptor = MultisigDescriptorSchema as unknown as MultisigDescriptor; 
            
            console.log("Config UTxO",this.configUtxo)
            const multisig = Lucid.Data.from(this.configUtxo.datum, MultisigDescriptor);
            console.log(multisig);
            const openRequests =await this.lucid.provider.getUtxos(this.address);
            const request = openRequests.find( (request) => request.txHash === txHash && request.outputIndex === index);
            console.log(request)
            
            const datum = this.decodeDatum(request.datum);
            const spendingTx =  this.lucid.newTx().attachSpendingValidator(this.mintingScript).collectFrom([request], Lucid.Data.void()).readFrom([this.configUtxo])
    
            
            const signersTx = this.lucid.newTx()
            quorum.forEach((signer) => {
                signersTx.addSigner(signer);
            });

            const referenceInput = this.lucid.newTx().readFrom([this.configUtxo]);
            const assets = {} 
            assets[this.cBTCPolicy + "63425443"] = datum.amount;
            const mintTx = this.lucid.newTx().attachMintingPolicy(this.mintingScript).mintAssets(assets, Lucid.Data.void()).attachMetadata(METADATA_TAG, metadata);
            
          
            const finalTx = this.lucid.newTx()
                                      .compose(signersTx)
                                      .compose(spendingTx)
                                      .compose(mintTx)
                                      .compose(referenceInput);
                                    
    
            try{
                const tx = await finalTx.complete({change: { address: await this.getUtxoSender(txHash, index)},  coinSelection : false, nativeUplc : false});
                const signature = await  tx.partialSign();
                communicator.cardanoTxToComplete( {type: "mint", txId : tx.toHash(), signatures: [signature] , tx , status: "pending", metadata});
            }catch(e){
                console.log("transaction building error:", e);
            }
            
            
            }catch(e){
                console.log(e);
        }}else{
            this.mintQueue.push({txHash, index , targetAddress: await this.getUtxoSender(txHash, index), completed : undefined, created: new Date()} );                
        }
    }

    async getTip(){
        try{
         const rcpClient = new CardanoSyncClient({ uri : this.config.utxoRpc.host,  headers:  this.config.utxoRpc.headers} );
         
        let tip = await axios.get(`${this.config.lucid.provider.host}/blocks/latest`, {headers: {"project_id": this.config.lucid.provider.projectId}});
        return tip;
        }catch(e){
        }
    }

    inSync(){
        return !this.syncing;
    }


    async dumpHistory(){

        
        try{
        const chunkSize = 100; 
        let tip = await this.mongo.collection("height").findOne({type: "top"});
        console.log("tip" , tip, this.config.startPoint);
        let tipPoint = undefined ;   
        if(tip){
            tipPoint = {index: tip.slot, hash: new Uint8Array(Buffer.from(tip.hash, "hex"))};
        }else if(this.config.startPoint){
            tipPoint = {index: this.config.startPoint.slot, hash: new Uint8Array(Buffer.from(this.config.startPoint.hash, "hex"))};
        }
        console.log("Starting sync from tip", tipPoint);
        const rcpClient = new CardanoSyncClient({ uri : this.config.utxoRpc.host,  headers : this.config.utxoRpc.headers} );
        let chunk = await rcpClient.inner.dumpHistory( {startToken: tipPoint, maxItems: chunkSize})
        console.log("Chunk", chunk);    
        
        while(chunk && chunk.nextToken ){
            console.time("Chunk")
            console.log(chunk.nextToken)
            tipPoint = chunk.nextToken;
            for (const block of chunk.block) {
                //console.log("Block:",  block);
                this.handleNewBlock(block.chain.value as CardanoBlock);
            };
            console.timeEnd("Chunk")
            //set tip to the last block
            console.time("NextChunkFetch")
            chunk = await rcpClient.inner.dumpHistory( {startToken: tipPoint, maxItems: chunkSize})
            console.timeEnd("NextChunkFetch")
        }

        console.log("Done Dumping History");
    }catch(e){
        console.log(e);
       await this.dumpHistory();
    }


        //exit the process
        console.log("Done Dumping History");
       }

    removeConsumedRequests( requests: Lucid.UTxO[]){
        this.rejectionQueue.forEach((request) => {
            const index = requests.findIndex((utxo) => utxo.txHash === request.txHash && utxo.outputIndex === request.index);
            if(index === -1){
                this.rejectionQueue = this.rejectionQueue.filter((req) => req.txHash !== request.txHash && req.index !== request.index);
            }
        });
    
    }

    async loadUtxos(){
        this.utxos = ((await this.lucid.provider.getUtxos(this.address)).filter((request) => request.datum));
    }

    async queryValidRequests(): Promise< [mintRequest[], redemptionRequest[]]> {
        try{
            
            const openRequests = [...this.utxos]

            this.removeConsumedRequests(openRequests);

            emitter.emit("requestsUpdate", openRequests);
            
            const mintRequests = openRequests.map((request) => {
                const isMint = Object.keys(request.assets).length === 1;
                if(isMint){
                const decodedRequest = request as mintRequest; // Cast decodedRequest to the correct type
                    try{    

                        decodedRequest["decodedDatum"] = this.decodeDatum(request.datum);
                        return decodedRequest;
                        
                    }catch(e){
                        console.log("Error Decoding Request", e);
                        this.rejectRequest(request.txHash, request.outputIndex);
                    }
                }
            });

            const redemptionRequests = openRequests.map((request) => {

                const isRedemption = Object.keys(request.assets).length === 2;
                if(isRedemption){
                    const decodedRequest = request as redemptionRequest; // Cast decodedRequest to the correct type
                    try{    
                        decodedRequest["decodedDatum"] = this.decodeRedemptionDatum(request.datum)
                        // if no token is being redeemed, reject the request
                        if(!decodedRequest.assets[this.cBTCPolicy +  this.cBtcHex] ){
                            this.rejectRequest(request.txHash, request.outputIndex);
                            return;
                        }
                        return decodedRequest;
                    
                    }catch(e){
                       // console.log("Error Decoding Request", e);
                        this.rejectRequest(request.txHash, request.outputIndex);
                    }
                }
            });
            this.redemptionRequests =  redemptionRequests.filter((request) => request)

            return [ mintRequests.filter((request) => request) , redemptionRequests.filter((request) => request)  ];

        }catch(e){
            console.log(e);
            return [ [], []];
        }
    }
     
    getRedemptionRequests() : redemptionRequest[]{
        return this.redemptionRequests;
    }    

    async startIndexer() {
        let tip = await this.mongo.collection("height").findOne({type: "top"});
        let liveTip = await this.getTip();  
        console.log(liveTip.data)

        
        console.log("tip" , tip);
        let tipPoint = undefined ;   
        if(tip){
            tipPoint = [{slot: tip.slot, hash: new Uint8Array(Buffer.from(tip.hash, "hex"))}];
        }



        console.log("Starting indexer from tip", tipPoint);
        const rcpClient = new CardanoSyncClient({ uri : this.config.utxoRpc.host,  headers : this.config.utxoRpc.headers} );
        const stream =  rcpClient.followTip( tipPoint);
        console.log("Stream", stream);  
        try {
        console.log("Starting Indexer");
        for await (const block of stream ) {
            
            switch (block.action) { 
                case "apply":
                    if(block.block.header.height >= liveTip.data.height){
                        this.syncing = false;
                    }
    
                    await this.handleNewBlock(block.block);
                    break;
                case "undo":
                    await this.handleUndoBlock(block.block); 
                    break;
                case "reset":
                    console.log(block.action, block.point);
                    break;
                default:
                    console.log("Strange Block");
                    console.log(block);
            }
        }
        } catch (e) {
            console.log(e);
            //sleep for 5 seconds and restart the indexer
            setTimeout(() => {
                this.startIndexer();
            }, 5000);
        }
    }

    async paymentProcessed(txid: string, vout: number): Promise<Boolean>{
        //find the payment in the list of mints in MongoDB, payments is a array of txId , check if the payment is in the list
       const match  = await this.mongo.collection("mint").findOne({payments:  { $in : [txId(txid, vout)]}});
       if(match === null){
              return false;
        }
       const tip = await this.getTip();
       const confirmations = tip.data.height - match.height;
       return  confirmations>=  coordinator.config.finality.cardano;
    }

    
    async handleUndoBlock(block: CardanoBlock){
        let blockHeight = block.header.height;
        const blockHash = Buffer.from(block.header.hash).toString('hex');
        await this.mongo.collection("mint").deleteMany({height: blockHeight});
        await this.mongo.collection("burn").deleteMany({height: blockHeight});


        await this.mongo.collection("height").updateOne({type: "top"}, {$set: {hash: blockHash, slot: block.header.slot, height: block.header.height}}, {upsert: true});
    }

    
    decodeDatum(datum: string)  {
        return Lucid.Data.from(datum, MintRequestSchema);
    }

    decodeRedemptionDatum(datum: string){
        return hexToString(Lucid.Data.from(datum, RedemptionRequestSchema).destinationAddress);
    }
    
    txCompleteFromString(txComplete : string){
        const Ctx = Lucid.C.Transaction.from_bytes(new Uint8Array(txComplete.match(/.{2}/g).map(byte => parseInt(byte, 16))));
        return new Lucid.TxComplete(this.lucid,Ctx);
    }

    async confirmRedemption(redemptionTx : string){

        console.log("Checking Burn redemption", redemptionTx);
        const tx = await this.mongo.collection("burn").findOne({ redemptionTx: redemptionTx});
        const tip = await this.getTip();
        if(!tx) return false;
        const confirmations = tip.data.height - tx.height;
        return  confirmations>=  coordinator.config.finality.cardano;
    }

    checkTransaction(txString : Lucid.TxComplete){
        const [txBody, cTx] = this.decodeTransaction(txString);
        txBody.inputs.forEach((input) => {
            if(input.address === this.address ){
                if(!this.utxos.some((utxo) => utxo.txHash === input.transaction_id && utxo.outputIndex === input.index)){
                        return false;
                }
            }
        });
        return true;
        

    }

    async isBurnConfirmed(txId : string){

        console.log("Checking Burn", txId);
        const tx = await this.mongo.collection("burn").findOne({ txHash: txId});
        console.log("Burn", tx);
        const tip = await this.getTip();
        if(!tx) return false; 
        const confirmations = tip.data.height - tx.height;
        return  confirmations >= coordinator.config.finality.cardano;
    }


    
    async getBurnByRedemptionTx(redemptionTx: string){
        console.log("Checking Burn", redemptionTx);
       // const hash = await this.(redemptionTx);
        const tx = await this.mongo.collection("burn").findOne({ redemptionTx});
        const tip = await this.getTip();
        if(!tx) return false;
        const confirmations = tip.data.height - tx.height;
        if(confirmations>= coordinator.config.finality.cardano){
            return tx;
        }else{
            return false;
        }
    }
    
    async handleNewBlock(block: CardanoBlock) : Promise<Boolean>{
        try{
            let tip = await this.mongo.collection("height").findOne({type: "top"});

            if(tip && tip.height == block.header.height){
                console.log("Block rollback", block.header.hash , block.header.height, tip.height);
                return false;

            }else if(tip && tip.height >= block.header.height){
                throw new Error(`Block already processed ${block.header.height}, registered tip: ${tip.height}`); 

            }

            let blockHash = Buffer.from(block.header.hash).toString('hex');
            await this.registerNewBlock(block);
            
            await this.mongo.collection("height").updateOne({type: "top"}, {$set: {hash: blockHash, slot: block.header.slot, height: block.header.height}}, {upsert: true});
            if(!this.syncing )
                emitter.emit("newCardanoBlock")
            
            return true;
        }catch(e){
            console.log(e);
        }
    }

    getCBtcId() : string{
        return this.cBTCPolicy + this.cBtcHex;
    }

    getCBtcPolicy() : string{
        return this.cBTCPolicy;
    }

    getCBtcHex() : string{
        return this.cBtcHex;
    }

    getTxSigners(txHex : string ) : string[]{
        const tx = this.txCompleteFromString(txHex);
        const [txBody, cTx] = this.decodeTransaction(tx);
        return cTx.body().required_signers().to_js_value();
    }

    async getUtxoSender(hash : string, index: number){
        const data = await axios.get(`${this.config.lucid.provider.host}/txs/${hash}/utxos`, {headers: {"project_id": this.config.lucid.provider.projectId}});
        return  data.data.inputs[0].address;
    }

    async registerNewBlock(block: CardanoBlock){
        await Promise.all(block.body.tx.map(async (tx) => {
            // find all mints of cBTC

            if(tx.mint.some((multiasset) => toHexString(multiasset.policyId) === this.cBTCPolicy)){
                console.log("Minting Transaction", tx, tx.mint);

                const multiasset = tx.mint.find((multiasset) => toHexString(multiasset.policyId) === this.cBTCPolicy);
                console.log("Multiasset", multiasset.assets[0].mintCoin);  
                const asset = multiasset.assets[0]; // assuming each Multiasset has exactly one Asset

                if(asset.mintCoin > 0n){
                    console.log(" Minting Transaction", tx);
                    
                    const payments = tx.auxiliary.metadata[0]?.value.metadatum.case === "array" ? tx.auxiliary.metadata[0].value.metadatum.value.items.map((item) => 
                        item.metadatum.case === "array" ? txId(item.metadatum.value.items[0].metadatum.value as string, Number(item.metadatum.value.items[1].metadatum.value))   : undefined   
                        )
                        : [];

                    
                    console.log("Payments", tx.auxiliary, payments);
                    this.mongo.collection("mint").insertOne({tx: tx, block: Buffer.from(block.header.hash).toString("hex"), height: block.header.height,payments });
                }
                
                else if(asset.mintCoin < 0n){
                    console.log("Burning Transaction", tx);
                    const redemptionTxraw = tx.auxiliary.metadata[0]?.value.metadatum.value as MetadatumArray 
                    const redemptionTx = redemptionTxraw.items.map((item) => item.metadatum.value).join("");
                    await coordinator.loadBurn(tx, block, redemptionTx);
                    this.mongo.collection("burn").insertOne({tx: tx, txHash: toHexString( tx.hash),block: Buffer.from(block.header.hash).toString("hex"), height: block.header.height, redemptionTx });
                    
                }
            }
        }));
    }
}
