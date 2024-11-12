import { Db } from "mongodb";
import { toHexString, txId,  hexToString } from "./helpers.js";
//import * as Lucid  from 'lucid-cardano'
import * as LucidEvolution from '@lucid-evolution/lucid'
import { U5C as UTXORpcProvider } from "@utxorpc/lucid-evolution-provider";

import { CardanoSyncClient  , CardanoQueryClient } from "@utxorpc/sdk";
import {MetadatumArray} from  "@utxorpc/spec/lib/utxorpc/v1alpha/cardano/cardano_pb.js";
import {DumpHistoryResponse} from "@utxorpc/spec/lib/utxorpc/v1alpha/sync/sync_pb.js";
import {cardanoConfig, secretsConfig, mintRequest , MintRequestSchema, RedemptionRequestSchema, utxo, redemptionRequest, protocolConfig} from "./types.js"
import axios from "axios";
import { getDb } from "./db.js";
import {  BTCWatcher, communicator, coordinator } from "./index.js";

export const METADATA_TAG = 85471236584;

export class CardanoWatcher{
    private mongo: Db;
    private utxos : LucidEvolution.UTxO[] = [];
    private lucid: LucidEvolution.LucidEvolution;
    private mintingScript: LucidEvolution.Script;
    private syncing: boolean = true;
    private cBTCPolicy: LucidEvolution.PolicyId;
    private cBtcHex: string;
    private address: string;
    private myKeyHash: string;
    private cardanoNetwork: LucidEvolution.Network;
    private configUtxo : LucidEvolution.UTxO;
    private config: cardanoConfig;
    private UintArrayAddress : Uint8Array;
    private redemptionRequests: redemptionRequest[] = [];   
    private rejectionQueue: {txHash: string, index: number , targetAddress : string , completed: Date | undefined , created: Date}[] = [];
    private confescationQueue: {txHash: string, index: number ,  completed: Date | undefined , created: Date}[] = [];
    private mintQueue: {txHash: string, index: number , targetAddress : string , completed: Date | undefined , created: Date}[] = [];
    private burnQueue: {txHash: string, index: number , completed: Date | undefined , created: Date }[] = [];

    constructor(config: cardanoConfig, secrets: secretsConfig, prorocolConfig: protocolConfig){

        this.mongo = getDb(config.DbName)
        console.log(typeof this.mongo)
        this.mintingScript = {type: "PlutusV3" , script: prorocolConfig.contract};
        this.queryValidRequests = this.queryValidRequests.bind(this);

        this.cardanoNetwork = config.network.charAt(0).toUpperCase() + config.network.slice(1) as LucidEvolution.Network;
        this.config = config;

        (async () => {
         
           this.lucid = await this.newLucidInstance ();
           this.lucid.selectWallet.fromSeed(secrets.seed);
           this.cBTCPolicy = LucidEvolution.mintingPolicyToId(this.mintingScript);
           console.log("Minting PolicyId:", this.cBTCPolicy);
           this.cBtcHex = "63425443";
           console.log(prorocolConfig.adminToken);
           this.configUtxo = await this.lucid.config().provider.getUtxoByUnit(prorocolConfig.adminToken);
           this.address =  LucidEvolution.credentialToAddress(this.cardanoNetwork ,{type: "Script", hash: this.cBTCPolicy});
           this.UintArrayAddress = LucidEvolution.CML.Address.from_bech32(this.address).to_raw_bytes();
           this.myKeyHash = LucidEvolution.getAddressDetails(await this.lucid.wallet().address()).paymentCredential.hash;
           console.log("Address", this.address);
           console.log("Local Address", await this.lucid.wallet().address());    
            await this.dumpHistory();
            this.startIndexer();
        })();        
        console.log("cardano watcher")
    }

    async newLucidInstance (){
        const network = (this.config.network.charAt(0).toUpperCase() + this.config.network.slice(1)) as LucidEvolution.Network;
        console.log(" Lucid Network", network);
       // return await LucidEvolution.Lucid(new LucidEvolution.Blockfrost(this.config.lucid.provider.host, this.config.lucid.provider.projectId), network);
        return await LucidEvolution.Lucid(new UTXORpcProvider({url: this.config.utxoRpc.host, headers: this.config.utxoRpc.headers}), network);
    }

    getDbName() : string{
      return  this.config.DbName;
    }

    async getAddress() : Promise<Object>{
        const localAddress = await this.lucid.wallet().address()
        return { "Prorocol Address" : this.address, "local address" : localAddress};
       
    }

    async submitTransaction(tx: LucidEvolution.TxSigned){
        //this.lucid.provider.submitTx(tx.toString());
        console.log("Submitting: ", tx.toJSON());
        
        try{
            //await axios.post( this.config.lucid.provider.host +"/tx/submit", Buffer.from(tx.toCBOR(), 'hex'), {headers: {"project_id": this.config.lucid.provider.projectId, "Content-Type": "application/cbor"}})   
             //await this.lucid.config().provider.submitTx(tx.toCBOR());
             await tx.submit();
           // await this.lucid.provider.submitTx(tx.toString());
        }catch(e){
            console.log(e);
        }
    }


    async signBurn(txHex : string){
        const signature =  (await this.lucid.wallet().signTx(LucidEvolution.CML.Transaction.from_cbor_hex(txHex) )).to_cbor_hex();
        console.log("Signature", signature);
        communicator.sendToLeader( "burnSignature" , signature.toString());
    }

    async burn(requests: redemptionRequest[], redemptionTx: string) : Promise< [LucidEvolution.TxSignBuilder , string]>{
        const splitIntoChunks = (str, chunkSize) => {
            const chunks = [];
            for (let i = 0; i < str.length; i += chunkSize) {
                chunks.push(str.substring(i, i + chunkSize));
            }
            return chunks;
        };
        
        try{
            if(communicator.amILeader()){
                const MultisigDescriptorSchema = LucidEvolution.Data.Object({ 
                    list: LucidEvolution.Data.Array(LucidEvolution.Data.Bytes()),
                    m: LucidEvolution.Data.Integer(),
                    });
                    
                const metadata = splitIntoChunks(redemptionTx, 64);

                type MultisigDescriptor = LucidEvolution.Data.Static<typeof MultisigDescriptorSchema>;
                const MultisigDescriptor = MultisigDescriptorSchema as unknown as MultisigDescriptor; 
                
                console.log("Config UTxO",this.configUtxo)
                const multisig = LucidEvolution.Data.from(this.configUtxo.datum, MultisigDescriptor);
                console.log(multisig);
                const openRequests =await this.lucid.config().provider.getUtxos(this.address);
                const request = requests;
                console.log(request)
                const assets = {} 
                assets[this.cBTCPolicy + this.cBtcHex] = -requests.reduce((acc, request) => acc + BigInt(request.assets[this.cBTCPolicy +  this.cBtcHex]), 0n);
                
                const spendingTx =  this.lucid.newTx().collectFrom(requests, LucidEvolution.Data.void())
                                                      .readFrom([this.configUtxo])
                                                      .attach.Script(this.mintingScript)
                                                      .mintAssets(assets, LucidEvolution.Data.void())
                                                      .attachMetadata(METADATA_TAG, metadata)
                                                      .validTo(new Date().getTime() + 14400000);
                const quorum = communicator.getQuorum();
                
                
                quorum.forEach((signer) => {
                    spendingTx.addSigner(signer);
                });

                
                // 4 hours later than now f
            
          
                const completedTx = await spendingTx.complete({changeAddress: coordinator.getConfig().adminAddress,  coinSelection : false});
                const signature = await  completedTx.partialSign.withWallet();
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

    
    decodeTransaction(tx : string) : [any, LucidEvolution.CML.Transaction]{
        const cTx = LucidEvolution.CML.Transaction.from_cbor_hex(tx);
        const txBody = JSON.parse(cTx.to_json()).body;
        
        return [txBody, cTx];
        
    }
    
    decodeSignature(signature: string) : {signature: string, signer: string, witness: LucidEvolution.CML.TransactionWitnessSet} {
    try{
        const uint8Array = new Uint8Array(signature.match(/.{2}/g).map(byte => parseInt(byte, 16)));
        const witness  =  LucidEvolution.CML.TransactionWitnessSet.from_cbor_bytes(uint8Array)
        const signer = witness.vkeywitnesses().get(0).vkey().hash().to_hex();
        return {signature, signer: signer , witness : witness}     
    
      }catch(e){
        console.log("Error Decoding Signature", e);     
      } 
    }

    requestId(request: LucidEvolution.UTxO){
        return request.txHash + request.outputIndex.toString();
    }
    
    async signReject(tx : {tx: string , txId: string}){
        const [txDetails, cTx] = this.decodeTransaction(tx.tx);
        // check the rejection queue for the request
        let requestTxHash = txDetails.inputs[0].transaction_id;
        let requestIndex = Number(txDetails.inputs[0].index);
        console.log("Signing Rejection", requestTxHash, requestIndex, txDetails, txDetails.outputs, this.rejectionQueue);
        const requestListing = this.rejectionQueue.find((request) => request.txHash === requestTxHash && request.index === requestIndex);
        if(!requestListing) throw new Error("Request not found in rejection queue");
        const amIaSigner = txDetails.required_signers.some(async (signature : string) => signature === this.myKeyHash);
        if(!amIaSigner) throw new Error("Not a signer for this request");
        const mintClean = txDetails.mint === null;
        const inputsClean = (txDetails.inputs.length === 1 && txDetails.inputs[0].transaction_id === requestTxHash && Number(txDetails.inputs[0].index) === requestIndex ); 
        const outputsClean = txDetails.outputs.length === 1 && txDetails.outputs[0].AlonzoFormatTxOut.address === requestListing.targetAddress ;
        const withdrawalsClean = txDetails.withdrawals === null;
        const allInputsMine = txDetails.inputs.every( (input) => input.transaction_id === requestTxHash && Number(input.index) === requestIndex);
        
        console.log(mintClean, inputsClean, outputsClean, withdrawalsClean , txDetails, !requestListing.completed, allInputsMine)
        if (requestListing && mintClean && inputsClean && outputsClean && withdrawalsClean && allInputsMine){
            const signature =  (await this.lucid.wallet().signTx(cTx)).to_cbor_bytes().reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
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
             
                

                const openRequests =await this.lucid.config().provider.getUtxos(this.address);
                const request = openRequests.find( (request) => request.txHash === txHash && request.outputIndex === index);
                console.log("request", request, this.configUtxo , quorum);
                const spendingTx =  this.lucid.newTx()
                                              .attach.SpendingValidator(this.mintingScript)
                                              .collectFrom([request], LucidEvolution.Data.void() )
                                              .readFrom([this.configUtxo])
                
                quorum.forEach((signer) => {
                    spendingTx.addSigner(signer);
                });

                
                try{
                    const tx = await spendingTx.complete({setCollateral: 5_000_000n, changeAddress: await this.getUtxoSender(txHash, index),  coinSelection : false});
                    const signature = await  tx.partialSign.withWallet();
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

    async signConfescation(tx : {tx: string , txId: string}){
        const [txDetails, cTx] = this.decodeTransaction(tx.tx);
        // check the rejection queue for the request
        let requestTxHash = txDetails.inputs[0].transaction_id;
        let requestIndex = Number(txDetails.inputs[0].index);
        const requestListing = this.confescationQueue.find((request) => request.txHash === requestTxHash && request.index === requestIndex);
        if(!requestListing) throw new Error("Request not found in confescation queue");
        const amIaSigner = txDetails.required_signers.some(async (signature : string) => signature === this.myKeyHash);
        if(!amIaSigner) throw new Error("Not a signer for this request");
        const mintClean = txDetails.mint === null;
        const inputsClean = (txDetails.inputs.length === 1 && txDetails.inputs[0].transaction_id === requestTxHash && Number(txDetails.inputs[0].index) === requestIndex); 
        const outputsClean = txDetails.outputs.length === 1 && txDetails.outputs[0].address === coordinator.config.adminAddress ;
        const withdrawalsClean = txDetails.withdrawals === null;
        
        console.log(mintClean, inputsClean, outputsClean, withdrawalsClean , txDetails, !requestListing.completed)
        if (requestListing && mintClean && inputsClean && outputsClean && withdrawalsClean){
            const signature =  (await this.lucid.wallet().signTx(cTx)).to_cbor_bytes().reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
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
       
                const openRequests =await this.lucid.config().provider.getUtxos(this.address);
                const request = openRequests.find( (request) => request.txHash === txHash && request.outputIndex === index);
                console.log(request)
                const spendingTx =  this.lucid.newTx()
                                            .attach.SpendingValidator(this.mintingScript)
                                            .collectFrom([request], LucidEvolution.Data.void() )
                                            .readFrom([this.configUtxo])
                
                
                
                quorum.forEach((signer) => {
                    spendingTx.addSigner(signer);
                });

                try{
                    const tx = await spendingTx.complete({changeAddress: coordinator.config.adminAddress,  coinSelection : false , localUPLCEval : false});
                    const signature = await  tx.partialSign.withWallet();
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
        const tmpTx = this.lucid.newTx().attachMetadata(METADATA_TAG, metadata).collectFrom(await this.lucid.wallet().getUtxos()).pay.ToAddress(await this.lucid.wallet().address(), {"lovelace": BigInt(1)});
         const tmpTxComplete = await tmpTx.complete({  coinSelection : false});
         const [txDetails, cTx] = this.decodeTransaction(tmpTxComplete.toCBOR({canonical : true}));
        return txDetails.auxiliary_data_hash === data_hash;
    }

    

    async signMint(tx : {tx: string , txId : string , metadata: [string, number][]}){
        try{
            const [txDetails, cTx] = this.decodeTransaction(tx.tx);
            console.log("Signing Mint", JSON.stringify(txDetails));
            let requestTxHash = txDetails.inputs[0].transaction_id;
            let requestIndex = Number(txDetails.inputs[0].index);
            if(! await this.checkMedatada(txDetails.auxiliary_data_hash, tx.metadata)) throw new Error("Invalid Metadata");
            const requestListing = this.mintQueue.find((request) => request.txHash === requestTxHash && request.index === requestIndex);
            if(!requestListing)  throw new Error("Request not found in mint queue");
            console.log("Request Listing", requestListing);
            const openRequests =await this.lucid.config().provider.getUtxos(this.address);
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

            const mintClean = Object.keys(txDetails.mint).length === 1  &&   Object.keys(txDetails.mint[this.cBTCPolicy]).length === 1 &&  Number(txDetails.mint[this.cBTCPolicy][this.cBtcHex]) === Number( (request.decodedDatum.amount)) ;
            const inputsClean = (txDetails.inputs.length === 1 && txDetails.inputs[0].transaction_id === request.txHash && Number(txDetails.inputs[0].index) ===  request.outputIndex);

            txDetails.outputs.forEach((output) => {
                if (output.AlonzoFormatTxOut.address !== requestListing.targetAddress)
                throw new Error("Invalid Output Address");
            });
            const withdrawalsClean = txDetails.withdrawals === null;
            const paymentComplete = Number(BTCWatcher.btcToSat(total)) >= Number( coordinator.calculatePaymentAmount(request, utxos.length));
            console.log(mintClean, inputsClean,  withdrawalsClean , !requestListing.completed,  coordinator.calculatePaymentAmount(request, utxos.length), paymentComplete,request.decodedDatum.amount , total)
            if (!requestListing.completed && mintClean && inputsClean &&  withdrawalsClean && paymentComplete ){
                const signature =  (await this.lucid.wallet().signTx(cTx)).to_cbor_bytes().reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
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
            const MultisigDescriptorSchema = LucidEvolution.Data.Object({ 
                list: LucidEvolution.Data.Array(LucidEvolution.Data.Bytes()),
                m: LucidEvolution.Data.Integer(),
            });
                
                
            const metadata = payments.map((payment) => {
                return [ payment.txid , payment.vout];
             });
            type MultisigDescriptor = LucidEvolution.Data.Static<typeof MultisigDescriptorSchema>;
            const MultisigDescriptor = MultisigDescriptorSchema as unknown as MultisigDescriptor; 
            
            console.log("Config UTxO",this.configUtxo)
            const openRequests =await this.lucid.config().provider.getUtxos(this.address);
            const request = openRequests.find( (request) => request.txHash === txHash && request.outputIndex === index);
            
            const datum = this.decodeDatum(request.datum);

            const assets : LucidEvolution.Assets = {} 
            assets[this.cBTCPolicy + "63425443"] = datum.amount;
            const network = (this.config.network.charAt(0).toUpperCase() + this.config.network.slice(1)) as LucidEvolution.Network;
            console.log(" Lucid Network", network);
           // return await LucidEvolution.Lucid(new LucidEvolution.Blockfrost(this.config.lucid.provider.host, this.config.lucid.provider.projectId), network);
            const localLucid = await LucidEvolution.Lucid(new UTXORpcProvider({url: this.config.utxoRpc.host, headers: this.config.utxoRpc.headers}), network);
            localLucid.selectWallet.fromAddress(await this.lucid.wallet().address(),await this.lucid.config().provider.getUtxos(await this.lucid.wallet().address()))
            const spendingTx =  this.lucid.newTx().attach.Script(this.mintingScript)
                                                  .collectFrom([request], LucidEvolution.Data.void())
                                                  .readFrom([this.configUtxo])
                                                  .mintAssets(assets, LucidEvolution.Data.void())
                                                  .attachMetadata(METADATA_TAG, metadata);
            
            quorum.forEach((signer) => {
                spendingTx.addSigner(signer);
            });
    
            try{
                const tx = await spendingTx.complete({setCollateral: 5_000_000n, changeAddress: await this.getUtxoSender(txHash, index),  coinSelection : false});
                const signature = await  tx.partialSign.withWallet();
                communicator.cardanoTxToComplete( {type: "mint", txId : tx.toHash(), signatures: [signature] , tx , status: "pending", metadata});
            }catch(e){
                console.log("transaction building error:", e);
            }
            
            
            }catch(e){
                console.log(e);
        }}else{
            this.mintQueue.push({txHash, index , targetAddress: await this.getUtxoSender(txHash, index), completed : undefined, created: new Date()});                
        }
    }

    getMyKeyHash(): [string, string]{
        return [ LucidEvolution.credentialToAddress( this.cardanoNetwork,{type: "Key", hash: this.myKeyHash}), this.myKeyHash];
    }

    async getTip(){
        try{
         
            let tip = await this.mongo.collection("height").findOne({type: "top"});
            return tip;
        }catch(e){
            return null;
        }
    }

    inSync(){
        return !this.syncing;
    }
    


    async dumpHistory(){
        const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
            const timeout = new Promise<null>((_, reject) =>
                setTimeout(() => reject(new Error('Timeout reached')), ms)
            );
            return Promise.race([promise, timeout]);
        };
        
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
        let chunk : DumpHistoryResponse | null
        const FIVE_MIN = 5 * 60 * 1000
        chunk =  await withTimeout(rcpClient.inner.dumpHistory( {startToken: tipPoint, maxItems: chunkSize}),FIVE_MIN)
        console.log("Chunk", chunk);    
        
        let processedHeight = tip ? tip.height : 0;

        while(chunk && chunk.nextToken && chunk.block.length > 0){
            console.time("Chunk")
            //const blockHeights = chunk.block.map(b => Number(b.chain.value.header.height));
            //console.log(`Block heights in chunk: ${JSON.stringify(blockHeights)}`);
            console.log("Processing chunk with", chunk.block.length, "blocks");
            tipPoint = chunk.nextToken;
            
            // Sort blocks by height in ascending order
            chunk.block.sort((a, b) => Number(a.chain.value.header.height) - Number(b.chain.value.header.height));
            
            for (const block of chunk.block) {
                const blockHeight = Number(block.chain.value.header.height);
                if (blockHeight > processedHeight) {
                    await this.handleNewBlock(block.chain.value);
                    processedHeight = blockHeight;
                } else {
                    console.log(`Skipping already processed block ${blockHeight}, processed height: ${processedHeight}`);
                }
            };
            console.timeEnd("Chunk")
            
            console.time("NextChunkFetch")
            chunk = await withTimeout(rcpClient.inner.dumpHistory({ startToken: tipPoint, maxItems: chunkSize }), FIVE_MIN);
            console.timeEnd("NextChunkFetch")
        }

        console.log("Done Dumping History");
    }catch(e){
        if (e.message === 'Timeout reached') {
            console.log('Timeout reached');
            console.log("Done Dumping History");
            return;
        } else {
            console.log(e);
            await this.dumpHistory();
        }
    }
        //exit the process
    console.log("Done Dumping History");
    }

    removeConsumedRequests( requests: LucidEvolution.UTxO[]){
        this.rejectionQueue.forEach((request) => {
            const index = requests.findIndex((utxo) => utxo.txHash === request.txHash && utxo.outputIndex === request.index);
            if(index === -1){
                this.rejectionQueue = this.rejectionQueue.filter((req) => req.txHash !== request.txHash && req.index !== request.index);
            }
        });
    
    }

    async loadUtxos(){
        this.utxos = ((await this.lucid.config().provider.getUtxos(this.address)).filter((request) => request.datum));
    }
    
    async queryValidRequests(): Promise< [mintRequest[], redemptionRequest[]]> {
        try{
            await this.loadUtxos();
            
            const openRequests = [...this.utxos]

            this.removeConsumedRequests(openRequests);

            
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
                        
                        if(!BTCWatcher.isAddressValid(decodedRequest.decodedDatum))
                        {
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
                    if(this.syncing === true ){
                        const currentSlot = LucidEvolution.unixTimeToSlot(this.cardanoNetwork, new Date().getTime()) ;
                        if(currentSlot <= Number(block.block.header.slot) + 20){
                            this.syncing = false;
                        }
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
       const confirmations = tip.height - match.height;
       return  confirmations>=  coordinator.config.finality.cardano;
    }

    
    async handleUndoBlock(block){
        let blockHeight = block.header.height;
        const blockHash = Buffer.from(block.header.hash).toString('hex');
        await this.mongo.collection("mint").deleteMany({height: blockHeight});
        await this.mongo.collection("burn").deleteMany({height: blockHeight});


        await this.mongo.collection("height").updateOne({type: "top"}, {$set: {hash: blockHash, slot: block.header.slot, height: block.header.height}}, {upsert: true});
    }

    
    decodeDatum(datum: string)  {
        return LucidEvolution.Data.from(datum, MintRequestSchema);
    }

    decodeRedemptionDatum(datum: string){
        return hexToString(LucidEvolution.Data.from(datum, RedemptionRequestSchema).destinationAddress);
    }
    
    txCompleteFromString(txComplete : string): LucidEvolution.TxSignBuilder {
        const Ctx = LucidEvolution.CML.Transaction.from_cbor_hex(txComplete);
        return LucidEvolution.makeTxSignBuilder(this.lucid.config(),Ctx);
    }

    async confirmRedemption(redemptionTx : string){

        console.log("Checking Burn redemption", redemptionTx);
        const tx = await this.mongo.collection("burn").findOne({ redemptionTx: redemptionTx});
        const tip = await this.getTip();
        if(!tx) return false;
        const confirmations = tip.height - tx.height;
        return  confirmations>=  coordinator.config.finality.cardano;
    }

    checkTransaction(txString : string){
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
        const confirmations = tip.height - tx.height;
        return  confirmations >= coordinator.config.finality.cardano;
    }


    
    async getBurnByRedemptionTx(redemptionTx: string){
        console.log("Checking Burn", redemptionTx);
       // const hash = await this.(redemptionTx);
        const tx = await this.mongo.collection("burn").findOne({ redemptionTx});
        const tip = await this.getTip();
        if(!tx) return false;
        const confirmations = tip.height - tx.height;
        if(confirmations>= coordinator.config.finality.cardano){
            return tx;
        }else{
            return false;
        }
    }
    
    async handleNewBlock(block) : Promise<Boolean>{
        try{
            let tip = await this.mongo.collection("height").findOne({type: "top"});

            let blockHash = Buffer.from(block.header.hash).toString('hex');
            let blockHeight = block.header.height;

            if(tip && tip.height >= blockHeight){
                console.log(`Skipping block ${blockHeight}, current tip: ${tip.height}`);
                return false;
            }

            await this.registerNewBlock(block);
            
            await this.mongo.collection("height").updateOne({type: "top"}, {$set: {hash: blockHash, slot: block.header.slot, height: blockHeight}}, {upsert: true});
            if(!this.syncing)
                coordinator.onNewCardanoBlock()            
            return true;
        } catch(e){
            console.log("Error handling new block:", e);
            return false;
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
        const [txBody, cTx] = this.decodeTransaction(txHex);
        const signers = []
        for(let i = 0; i < cTx.body().required_signers().len(); i++){
            signers.push(cTx.body().required_signers().get(i).to_hex());
        }
        return signers;
    }

    async getUtxoSender(hash : string, index: number){
        let data = await this.mongo.collection("incoming").findOne({txHash: hash});
        while(!data){
            await new Promise(resolve => setTimeout(resolve, 1000));
            data = await this.mongo.collection("incoming").findOne({txHash: hash});
        }
        return data.sender;

    }

    async registerNewBlock(block){
        function areUint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
            if (a.length !== b.length) {
                return false;
            }
            for (let i = 0; i < a.length; i++) {
                if (a[i] !== b[i]) {
                    return false;
                }
            }
            return true;
          }

        await Promise.all(block.body.tx.map(async (tx) => {
            // find all mints of cBTC
            if(tx.outputs.some((output) => areUint8ArraysEqual(output.address, this.UintArrayAddress))){
                  console.log("Found a incoming request", block.header.height, tx.hash);
                  const txHash = Buffer.from(tx.hash).toString('hex');
                  const addressRawAddress = LucidEvolution.CML.Address.from_raw_bytes(tx.inputs[0].asOutput.address);
                  let sender = addressRawAddress.to_bech32( this.cardanoNetwork === "Mainnet" ? "addr" : "addr_test");
                  
                  this.mongo.collection("incoming").insertOne({tx: tx , txHash,  block: Buffer.from(block.header.hash).toString("hex"), height: block.header.height, sender});
                    
                  console.log("TxHash", txHash);
                  // incoming request
              } 
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
