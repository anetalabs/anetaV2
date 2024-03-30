import { MongoClient } from "mongodb";
import * as Lucid  from 'lucid-cardano'
import { CardanoSyncClient , CardanoBlock } from "@utxorpc/sdk";
import {cardanoConfig, topology, secretsConfig} from "./types.js"
import {emitter}  from "./coordinator.js";
import axios from "axios";

const MintRequesrSchema = Lucid.Data.Object({
    amount: Lucid.Data.Integer(),
    path: Lucid.Data.Integer(),
  });


  


export class cardanoWatcher{
    private mongo: MongoClient;
    private lucid: Lucid.Lucid;
    private mintingScript: Lucid.Script;
    private syncing: boolean = true;
    private cBTCPolicy: Lucid.PolicyId;
    private address: string;
    private mintRequests: any[] = [];

    private configUtxo : Lucid.UTxO;

    constructor(config: cardanoConfig, topology: topology, secrets: secretsConfig ){
        let mongoClient = new MongoClient(config.mongo.connectionString);

        this.mintingScript = {type: "PlutusV2" , script: config.contract};

        mongoClient.connect()
            .then(async (client) => {

                this.mongo = client;
                console.log("Connected to MongoDB");
                console.time("dumpHistory");
                await this.dumpHistory();
                console.timeEnd("dumpHistory");
                this.startIndexer();
            })
            .catch((error) => {
                console.error("Failed to connect to MongoDB:", error);
            });
        (async () => {
           this.lucid.selectWalletFromSeed(secrets.seed);
           console.log(this.lucid.utils.getAddressDetails( await this.lucid.wallet.address()));
           console.log("Minting Script Address:", this.mintingScript);
           emitter.emit("notification", "Cardano Watcher Ready");
           this.cBTCPolicy = this.lucid.utils.mintingPolicyToId(this.mintingScript);
           console.log("Minting PolicyId:", this.cBTCPolicy);
           this.configUtxo =await this.lucid.provider.getUtxoByUnit("a653490ca18233f06e7f69f4048f31ade4e3885750beae0170d7c8ae634e65746142726964676541646d696e");
           this.address =  this.lucid.utils.credentialToAddress({type: "Script", hash: this.cBTCPolicy});
           console.log("Address", this.address);
           console.log("Local Address", await this.lucid.wallet.address());
        })();
        

        console.log("cardano watcher")
    }


    async getOpenRequests(){
    
        return [];
    }

    async fulfillRequest(txHash: string, index: number){
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
            
            const datum = this.decodeDatum(request.datum);
            const spendingTx =  this.lucid.newTx().attachSpendingValidator(this.mintingScript).collectFrom([request], Lucid.Data.void()).readFrom([this.configUtxo])
    
            
            const signersTx = this.lucid.newTx().addSigner(await this.lucid.wallet.address())
            const referenceInput = this.lucid.newTx().readFrom([this.configUtxo]);
            const assets = {} 
            assets[this.cBTCPolicy + "63425443"] = datum.amount;
            const mintTx = this.lucid.newTx().attachMintingPolicy(this.mintingScript).mintAssets(assets, Lucid.Data.void());

          
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
        }catch(e){
                console.log(e);
            }
    
    
    
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
        signedTx.submit();    
    }catch(e){
            console.log(e);
        }

    }
     
    async mint(){

    }

    async getTip(){
        return tip;
    }

    inSync(){
        return !this.syncing;
    }

    async dumpHistory(){
        const chunkSize = 100; 
        let tip = await this.mongo.db("cNeta").collection("height").findOne({type: "top"});
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
            await this.mongo.db("cNeta").collection("height").updateOne({type: "top"}, {$set: {hash: Buffer.from(lastBlock.header.hash).toString('hex') , slot: lastBlock.header.slot, height: lastBlock.header.height}}, {upsert: true});
            console.time("NextChunkFetch")
            chunk = await rcpClient.inner.dumpHistory( {startToken: tipPoint, maxItems: chunkSize});
            console.timeEnd("NextChunkFetch")
        }

        //exit the process
        console.log("Done Dumping History");

       

    }

    async queryValidRequests(){
        const openRequests = await this.lucid.provider.getUtxos(this.address);
        console.log("Open Requests", openRequests);
        const validRequests = openRequests.filter( (request) => {
           return request.datum 
        });
        return validRequests;
    }
    
    async startIndexer() {
        let tip = await this.mongo.db("cNeta").collection("height").findOne({type: "top"});
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
                  

                    ///////////////
                    const utxo = await this.queryValidRequests();
                    if( utxo.length > 0) this.fulfillRequest(utxo[0].txHash, utxo[0].outputIndex)
                    ///////////////
                    const result = await this.handleNewBlock(block.block);
                    if(!result){
                      //  throw new Error("Block Already Processed");
                    }
                    break;
                case "undo":
                    await this.handleUndoBlock(block.block); 
                    this.loop();
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
            this.startIndexer();    
        }
    }

    async loop(){
        console.log("Looping");
    }


    
    async handleUndoBlock(block: CardanoBlock){
     //   await this.mongo.db("cNeta").collection("height").updateOne({type: "top"}, {$set: {hash: block.header.hash, slot: block.header.slot, height: block.header.height}}, {upsert: true});
     //   console.log("Undo Block", block.header.hash);
    }

    decodeDatum(datum: string){
        return Lucid.Data.from(datum, MintRequesrSchema);
    }
    
    async handleNewBlock(block: CardanoBlock) : Promise<Boolean>{
        let tip = await this.mongo.db("cNeta").collection("height").findOne({type: "top"});

        if(tip && tip.height >= block.header.height){
           // console.log("Already Processed Block", block.header.hash);
            return false;
        }

        let blockHash = Buffer.from(block.header.hash).toString('hex');
        this.registerNewBlock(block);
        await this.mongo.db("cNeta").collection("height").updateOne({type: "top"}, {$set: {hash: blockHash, slot: block.header.slot, height: block.header.height}}, {upsert: true});
        emitter.emit("newCardanoBlock")
        console.log("New Cardano Block",blockHash, block.header.slot,  block.header.height);
        return true;
    }

 

    async getUtxoSender(hash : string, index: number){
        return  data.data.inputs[index].address;
    }

    async registerNewBlock(block: CardanoBlock){
        await Promise.all(block.body.tx.map(async (tx) => {
            // find all mints of cBTC
           if(Object.keys(tx.mint).includes(this.cBTCPolicy)){
               console.log("Minting Transaction", tx);
               this.mongo.db("cNeta").collection("mint").insertOne({tx: tx, block: block.header.hash, height: block.header.height});
           }
        })) ;
    }

}
