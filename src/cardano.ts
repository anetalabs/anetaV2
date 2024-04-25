import { Db } from "mongodb";
import { toHexString, txId, hash } from "./helpers.js";
import * as Lucid  from 'lucid-cardano'
import { CardanoSyncClient , CardanoBlock } from "@utxorpc/sdk";
import {cardanoConfig, topology, secretsConfig, decodedRequest, MintRequesrSchema, RedemptionRequestSchema, utxo} from "./types.js"
import {emitter}  from "./coordinator.js";
import axios from "axios";
import { getDb } from "./db.js";

const METADATA_TAG = 85471236584;

export class cardanoWatcher{
    private mongo: Db;
    private lucid: Lucid.Lucid;
    private mintingScript: Lucid.Script;
    private syncing: boolean = true;
    private cBTCPolicy: Lucid.PolicyId;
    private address: string;
    private mintRequests: any[] = [];
    private requestsFulfilled: string[] = [];
    private configUtxo : Lucid.UTxO;
    private config: cardanoConfig;
    constructor(config: cardanoConfig, topology: topology, secrets: secretsConfig ){
        this.mongo = getDb("cNeta")
        console.log(typeof this.mongo)
        this.mintingScript = {type: "PlutusV2" , script: config.contract};
        this.queryValidRequests = this.queryValidRequests.bind(this);

        this.config = config;

        (async () => {
           this.lucid = await Lucid.Lucid.new(new Lucid.Blockfrost(config.lucid.provider.host, "previewB9itCoBdnffsAjAyqLCSrGCB2kntLwWC"), (config.network.charAt(0).toUpperCase() + config.network.slice(1)) as Lucid.Network);
           this.lucid.selectWalletFromSeed(secrets.seed);
           console.log("Minting Script Address:", this.mintingScript);
           emitter.emit("notification", "Cardano Watcher Ready");
           this.cBTCPolicy = this.lucid.utils.mintingPolicyToId(this.mintingScript);
           console.log("Minting PolicyId:", this.cBTCPolicy);
           this.configUtxo =await this.lucid.provider.getUtxoByUnit("a653490ca18233f06e7f69f4048f31ade4e3885750beae0170d7c8ae634e65746142726964676541646d696e");
           this.address =  this.lucid.utils.credentialToAddress({type: "Script", hash: this.cBTCPolicy});
           console.log("Address", this.address);
           console.log("Local Address", await this.lucid.wallet.address());    
            await this.dumpHistory();
            console.timeEnd("dumpHistory");
            this.startIndexer();
        })();
        

        console.log("cardano watcher")
    }


    async burn(requests: decodedRequest[], redemptionTx: string){
        try{
            
            // check that we are synced with the tip
            const MultisigDescriptorSchema = Lucid.Data.Object({ 
                list: Lucid.Data.Array(Lucid.Data.Bytes()),
                m: Lucid.Data.Integer(),
                });
                
                
            const metadata = await hash(redemptionTx);

            type MultisigDescriptor = Lucid.Data.Static<typeof MultisigDescriptorSchema>;
            const MultisigDescriptor = MultisigDescriptorSchema as unknown as MultisigDescriptor; 
            
            console.log("Config UTxO",this.configUtxo)
            const multisig = Lucid.Data.from(this.configUtxo.datum, MultisigDescriptor);
            console.log(multisig);
            const openRequests =await this.lucid.provider.getUtxos(this.address);
            const request = requests;
            console.log(request)
            
            const spendingTx =  this.lucid.newTx().attachSpendingValidator(this.mintingScript).collectFrom(requests, Lucid.Data.void()).readFrom([this.configUtxo])
    
            
            const signersTx = this.lucid.newTx().addSigner(await this.lucid.wallet.address())
            const referenceInput = this.lucid.newTx().readFrom([this.configUtxo]);
            const assets = {} 
            assets[this.cBTCPolicy + "63425443"] = -requests.reduce((acc, request) => acc + Number(request.assets[this.cBTCPolicy + "63425443"]) , 0);
            const mintTx = this.lucid.newTx().attachMintingPolicy(this.mintingScript).mintAssets(assets, Lucid.Data.void()).attachMetadata(METADATA_TAG, metadata);
            
          
            const finalTx = this.lucid.newTx()
                                      .compose(signersTx)
                                      .compose(spendingTx)
                                      .compose(mintTx)
                                      .compose(referenceInput);
                                    
    
            const completedTx = await finalTx.complete({change: { address: "addr_test1qrlmv3gjf253v49u8v5psxzwtlf6uljc5xf3a24ehfzcyz32ptyyevm796lgrkz2t5vrx3snmmsfh0ntc333mqf6eagstyc95m" },  coinSelection : false});
            const signatures = await  completedTx.partialSign();
            const signedTx = await completedTx.assemble([signatures]).complete();
            console.log("signature", signatures);
            console.log("completedTx", signedTx.toString());
            return await signedTx.submit();    

        }catch(e){
                console.log(e);
            }
    }
    async fulfillRequest(txHash: string, index: number, payments: utxo[]){
        try{
            for(let payment of payments){
                if(await this.paymentProcessed(payment)){
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
    
            
            const signersTx = this.lucid.newTx().addSigner(await this.lucid.wallet.address())
            const referenceInput = this.lucid.newTx().readFrom([this.configUtxo]);
            const assets = {} 
            assets[this.cBTCPolicy + "63425443"] = datum.amount;
            const mintTx = this.lucid.newTx().attachMintingPolicy(this.mintingScript).mintAssets(assets, Lucid.Data.void()).attachMetadata(METADATA_TAG, metadata);
            
          
            const finalTx = this.lucid.newTx()
                                      .compose(signersTx)
                                      .compose(spendingTx)
                                      .compose(mintTx)
                                      .compose(referenceInput);
                                    
    
            const completedTx = await finalTx.complete({change: { address: await this.getUtxoSender(txHash, index)},  coinSelection : false});
            const signatures = await  completedTx.partialSign();
            const signedTx = await completedTx.assemble([signatures]).complete();
            console.log("signature", signatures);
            console.log("completedTx", signedTx.toString());
            await signedTx.submit();    
            this.requestsFulfilled.push(this.requestId(request));
        }catch(e){
                console.log(e);
            }
    }

    requestId(request: Lucid.UTxO){
        return request.txHash + request.outputIndex.toString();
    }

    async rejectRequest(txHash: string, index: number){
        try{

        const MultisigDescriptorSchema = Lucid.Data.Object({ 
            list: Lucid.Data.Array(Lucid.Data.Bytes()),
            m: Lucid.Data.Integer(),
            });
            
            
        type MultisigDescriptor = Lucid.Data.Static<typeof MultisigDescriptorSchema>;
        const MultisigDescriptor = MultisigDescriptorSchema as unknown as MultisigDescriptor; 
        console.log("Config UTxO",this.configUtxo)
        const multisig = Lucid.Data.from(this.configUtxo.datum, MultisigDescriptor);
        console.log(multisig);
        const openRequests =await this.lucid.provider.getUtxos(this.address);
        const request = openRequests.find( (request) => request.txHash === txHash && request.outputIndex === index);
        console.log(request)
        
        const spendingTx =  this.lucid.newTx().attachSpendingValidator(this.mintingScript).collectFrom([request], Lucid.Data.void()).readFrom([this.configUtxo])

        
        const signersTx = this.lucid.newTx().addSigner(await this.lucid.wallet.address())
        const referenceInput = this.lucid.newTx().readFrom([this.configUtxo]);
        
        const outputTx = this.lucid.newTx().payToAddress(await this.getUtxoSender(txHash, index), { "lovelace": 1000000n});
        const finalTx = this.lucid.newTx()
                                  .compose(signersTx)
                                  .compose(spendingTx)
                               //   .compose(outputTx)

                                  .compose(referenceInput);


        const completedTx = await finalTx.complete({change: { address: await this.getUtxoSender(txHash, index)},  coinSelection : false});
        const signatures = await  completedTx.partialSign();
        const signedTx = await completedTx.assemble([signatures]).complete();
        console.log("signature", signatures);
        console.log("completedTx", signedTx.toString());
        await signedTx.submit();    
        this.requestsFulfilled.push(this.requestId(request));
    }catch(e){
            console.log(e);
        }

    }
     


    async getTip(){
        let tip = await axios.get("https://cardano-preview.blockfrost.io/api/v0/blocks/latest", {headers: {"project_id": "previewB9itCoBdnffsAjAyqLCSrGCB2kntLwWC"}});
        return tip;
    }

    inSync(){
        return !this.syncing;
    }

    async dumpHistory(){
        const chunkSize = 100; 
        let tip = await this.mongo.collection("height").findOne({type: "top"});
        console.log("tip" , tip);
        let tipPoint = undefined ;   
        if(tip){
            tipPoint = {index: tip.slot, hash: tip.hash};
        }


        console.log("Starting from tip", tipPoint);
        const rcpClient = new CardanoSyncClient({ uri : "https://preview.utxorpc-v0.demeter.run",  headers: {"dmtr-api-key": "dmtr_utxorpc1rutw90zm5ucx4lg9tj56nymnq5j98zlf"}} );
        let chunk = await rcpClient.inner.dumpHistory( {startToken: tipPoint, maxItems: chunkSize});
        while(chunk.nextToken ){
            console.time("Chunk")
            console.log(chunk.nextToken)
            tipPoint = chunk.nextToken;
            await Promise.all( chunk.block.map( (block) => {
                //console.log("Block:",  block);
                this.registerNewBlock(block.chain.value as CardanoBlock);
            }));
            console.timeEnd("Chunk")
            //set tip to the last block
            const lastBlock = chunk.block[chunk.block.length - 1].chain.value as CardanoBlock;
            console.log("Last Block", chunk);   
            await this.mongo.collection("height").updateOne({type: "top"}, {$set: {hash: Buffer.from(lastBlock.header.hash).toString('hex') , slot: lastBlock.header.slot, height: lastBlock.header.height}}, {upsert: true});
            console.time("NextChunkFetch")
            chunk = await rcpClient.inner.dumpHistory( {startToken: tipPoint, maxItems: chunkSize});
            console.timeEnd("NextChunkFetch")
        }

        //exit the process
        console.log("Done Dumping History");

       

    }

    async queryValidRequests(): Promise<decodedRequest[]> {
        try{
            const openRequests = await this.lucid.provider.getUtxos(this.address);


            const validRequests = openRequests.filter((request) => {
                return request.datum ;
            });

       
            
            const decodedRequests = validRequests.map((request) => {
                const isMint = Object.keys(request.assets).length === 1;
                const decodedRequest = request as decodedRequest; // Cast decodedRequest to the correct type
                try{    

                    decodedRequest["decodedDatum"] = isMint ?  this.decodeDatum(request.datum) : this.decodeRedemptionDatum(request.datum);
                    return decodedRequest;
                }catch(e){
                    console.log("Error Decoding Request", e);
                    this.rejectRequest(request.txHash, request.outputIndex);
                }
            });
            return decodedRequests;
        }catch(e){
            console.log(e);
            return [];
        }
    }
    
    async startIndexer() {
        let tip = await this.mongo.collection("height").findOne({type: "top"});
        let liveTip = await this.getTip();  
        console.log(liveTip.data)

        console.log("tip" , tip);
        let tipPoint = undefined ;   
        if(tip){
            tipPoint = [{slot: tip.slot, hash: tip.hash}];
        }



        console.log("Starting from tip", tipPoint);
        const rcpClient = new CardanoSyncClient({ uri : "https://preview.utxorpc-v0.demeter.run",  headers: {"dmtr-api-key": "dmtr_utxorpc1rutw90zm5ucx4lg9tj56nymnq5j98zlf"}} );
        console.log(rcpClient.inner.dumpHistory)
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

    async paymentProcessed(payment: utxo): Promise<Boolean>{
        //find the payment in the list of mints in MongoDB, payments is a array of txId , check if the payment is in the list
       const match = await this.mongo.collection("mint").find({payments:  { $in : [txId(payment.txid, payment.vout)]}}).toArray();

       return match.length > 0;
    }

    
    async handleUndoBlock(block: CardanoBlock){
        let blockHeight = block.header.height;
        const blockHash = Buffer.from(block.header.hash).toString('hex');
        await this.mongo.collection("mint").deleteMany({height: blockHeight});
        await this.mongo.collection("burn").deleteMany({height: blockHeight});


        await this.mongo.collection("height").updateOne({type: "top"}, {$set: {hash: blockHash, slot: block.header.slot, height: block.header.height}}, {upsert: true});
    }

    
    decodeDatum(datum: string){
        return Lucid.Data.from(datum, MintRequesrSchema);
    }

    decodeRedemptionDatum(datum: string){
        return Lucid.Data.from(datum, RedemptionRequestSchema);
    }

    async isBurnConfirmed(txHash: string){
        console.log("Checking Burn", txHash);
        const tx = await this.mongo.collection("burn").findOne({ txHash: txHash});
        console.log("Burn", tx);
        const tip = await this.getTip();
        if(!tx) return false;
        const confirmations = tip.data.height - tx.height;
        return  confirmations>= this.config.finality;
    }
    
    async handleNewBlock(block: CardanoBlock) : Promise<Boolean>{
        let tip = await this.mongo.collection("height").findOne({type: "top"});

        if(tip && tip.height == block.header.height){
            console.log("Block replaying tip", block.header.hash);
            return false;

        }else if(tip && tip.height >= block.header.height){
            throw new Error(`Block already processed ${block.header.height}, registered tip: ${tip.height}`); 

        }

        let blockHash = Buffer.from(block.header.hash).toString('hex');
        this.registerNewBlock(block);
        
        await this.mongo.collection("height").updateOne({type: "top"}, {$set: {hash: blockHash, slot: block.header.slot, height: block.header.height}}, {upsert: true});
        if(!this.syncing )
            emitter.emit("newCardanoBlock")
        
        console.log("New Cardano Block",blockHash, block.header.slot,  block.header.height);
        return true;
    }



    async getUtxoSender(hash : string, index: number){
        const data = await axios.get("https://cardano-preview.blockfrost.io/api/v0/txs/" + hash + "/utxos", {headers: {"project_id": "previewB9itCoBdnffsAjAyqLCSrGCB2kntLwWC"}});
        return  data.data.inputs[index].address;
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
                    this.mongo.collection("mint").insertOne({tx: tx, block: block.header.hash, height: block.header.height,payments });
                }
                
                else if(asset.mintCoin < 0n){
                    console.log("Burning Transaction", tx);
                    const redermptionTransaction = tx.auxiliary.metadata[0]?.value.metadatum.value; 
                    this.mongo.collection("burn").insertOne({tx: tx, txHash: toHexString( tx.hash),block: block.header.hash, height: block.header.height, redermptionTransaction });
                }
            }
        }));
    }

}
