import { MongoClient } from "mongodb";
import * as Lucid  from 'lucid-cardano'
import { CardanoSyncClient , CardanoBlock } from "@utxorpc/sdk";
import {cardanoConfig, topology, secretsConfig} from "./types.js"
import {emmiter}  from "./coordinator.js";
 

const MintRequesrSchema = Lucid.Data.Object({
    amount: Lucid.Data.Integer(),
    path: Lucid.Data.Integer(),
  });
  


export class cardanoWatcher{
    private mongo: MongoClient;
    private lucid: Lucid.Lucid;
    private mintingScript: Lucid.Script;
    private topology: topology;
    private config: cardanoConfig;
    private cBTCPolicy: Lucid.PolicyId;

    constructor(config: cardanoConfig, topology: topology, secrets: secretsConfig ){
        this.config = config;
        this.topology = topology;
        let mongoClient = new MongoClient(config.mongo.connectionString);
         
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
           this.lucid = await Lucid.Lucid.new(new Lucid.Blockfrost(config.lucid.provider.host), (config.network.charAt(0).toUpperCase() + config.network.slice(1)) as Lucid.Network);
           this.lucid.selectWalletFromSeed(secrets.seed);
           console.log(this.lucid.utils.getAddressDetails( await this.lucid.wallet.address()));
           this.mintingScript = this.lucid.utils.nativeScriptFromJson(config.mintingScript as Lucid.NativeScript);
           console.log("Minting Script Address:", this.mintingScript);
           console.log("Minting PolicyId:", this.lucid.utils.mintingPolicyToId(this.mintingScript));
           this.cBTCPolicy = this.lucid.utils.mintingPolicyToId(this.mintingScript);
        })();
        

        console.log("cardano watcher")
    }

    async getOpenRequests(){
        let openRequests = this.lucid.provider.getUtxos(this.config.paymentAddress);
        return openRequests;
    }
     
    async mint(){

    }
    async getTip(){
        let tip = await this.mongo.db("cNeta").collection("height").findOne({type: "top"});
        return tip;
    }

    async dumpHistory(){
        let tip = await this.mongo.db("cNeta").collection("height").findOne({type: "top"});
        console.log("tip" , tip);
        let tipPoint = undefined ;   
        if(tip){
            tipPoint = {index: tip.slot, hash: tip.hash};
        }


        console.log("Starting from tip", tipPoint);
        const rcpClient = new CardanoSyncClient({ uri : "https://preview.utxorpc-v0.demeter.run",  headers: {"dmtr-api-key": "dmtr_utxorpc1rutw90zm5ucx4lg9tj56nymnq5j98zlf"}} );
        let chunk = await rcpClient.inner.dumpHistory( {startToken: tipPoint, maxItems: 1000});
        console.log("Stream", chunk);  
        while(chunk.block.length > 0){
            await Promise.all( chunk.block.map( (block) => {
                //console.log("Block:",  block);
                this.registerNewBlock(block.chain.value as CardanoBlock);
            }));
            //set tip to the last block
            console.log("Chunk", chunk.nextToken, chunk.block.length)
            const lastBlock = chunk.block[chunk.block.length - 1].chain.value as CardanoBlock;
            await this.mongo.db("cNeta").collection("height").updateOne({type: "top"}, {$set: {hash: Buffer.from(lastBlock.header.hash).toString('hex') , slot: lastBlock.header.slot, height: lastBlock.header.height}}, {upsert: true});
            chunk = await rcpClient.inner.dumpHistory( {startToken: chunk.nextToken, maxItems: 1000});
        }
       
        //sleep 15 seconds then exit
        await new Promise((resolve) => setTimeout(resolve, 15000));
        process.exit(0);
    }

    
    async startIndexer() {
        let tip = await this.mongo.db("cNeta").collection("height").findOne({type: "top"});
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
            this.startIndexer();    
        }
    }
    async handleUndoBlock(block: CardanoBlock){
     //   await this.mongo.db("cNeta").collection("height").updateOne({type: "top"}, {$set: {hash: block.header.hash, slot: block.header.slot, height: block.header.height}}, {upsert: true});
     //   console.log("Undo Block", block.header.hash);
    }

    decodeDatum(datum: string){
        return Lucid.Data.from(datum, MintRequesrSchema);
    }
    
    async handleNewBlock(block: CardanoBlock){
        let tip = await this.mongo.db("cNeta").collection("height").findOne({type: "top"});

        if(tip && tip.height >= block.header.height){
            console.log("Already Processed Block", block.header.hash);
            return;
        }

        let blockHash = Buffer.from(block.header.hash).toString('hex');
 
        this.registerNewBlock(block);
        await this.mongo.db("cNeta").collection("height").updateOne({type: "top"}, {$set: {hash: blockHash, slot: block.header.slot, height: block.header.height}}, {upsert: true});
        emmiter.emit("newCardanoBlock")
    }

    async registerNewBlock(block: CardanoBlock){
        let blockHash = Buffer.from(block.header.hash).toString('hex');

        console.log("New Cardano Block",blockHash, block.header.slot,  block.header.height);


        await Promise.all(block.body.tx.map(async (tx) => {
            block.body.tx.map((tx) => {
           if(Object.keys(tx.mint).includes(this.cBTCPolicy)){
               console.log("Minting Transaction", tx);
           }
        }
    
        )})) ;
    }
}
