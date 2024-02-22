import { MongoClient } from "mongodb";
import * as Lucid  from 'lucid-cardano'
import { CardanoSyncClient , CardanoBlock } from "@utxorpc/sdk";
import {cardanoConfig, topology, secretsConfig} from "./types.js"

// Initialize the UtxoRpc client
 


export class cardanoWatcher{
    private mongo: MongoClient;
    private lucid: Lucid.Lucid;
    private rcpClient : CardanoSyncClient;
    private mintingScript: Lucid.Script;
    private topology: topology;

    constructor(config: cardanoConfig, topology: topology, secrets: secretsConfig ){
        this.rcpClient = new CardanoSyncClient({ uri : "https://preview.utxorpc-v0.demeter.run",  headers: {"dmtr-api-key": "dmtr_utxorpc1rutw90zm5ucx4lg9tj56nymnq5j98zlf"}} );
        let mongoClient = new MongoClient(config.mongo.connectionString);
        mongoClient.connect()
            .then((client) => {
                this.mongo = client;
                console.log("Connected to MongoDB");
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
        })();
        

        console.log("cardano watcher")
    }

    async getOpenRequests(){
      //  let openRequests = this.lucid.provider.getUtxos(config.paymentAddress);
      //  return openRequests;
    }
     
    async getTip(){
        let tip = await this.mongo.db("cNeta").collection("height").findOne({type: "top"});
        return tip;
    }

    async startIndexer() {
        // get the current tip from the database and start following the tip from there, if there is no tip in the database, start from the genesis block 
        let tip = await this.mongo.db("cNeta").collection("height").findOne({type: "top"});
        console.log("tip" , tip);
        let tipPoint = undefined ;   
        if(tip){
            tipPoint = [{slot: tip.slot, hash: tip.hash}];
        }
        console.log("Starting from tip", tipPoint);
        const stream = this.rcpClient.followTip(tipPoint);
        try {
        console.log("Starting Indexer");
        for await (const block of stream) {
            switch (block.action) { 
                case "apply":

                    await this.handleNewBlock(block.block);
                    break;
                case "undo":
                    console.log(block.action, block.block);
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
        console.log("Undo Block", block.header.hash);
    }
    
    async handleNewBlock(block: CardanoBlock){
        //Uint8Array(32) to hex
        let blockHash = Buffer.from(block.header.hash).toString('hex');
        await this.mongo.db("cNeta").collection("height").updateOne({type: "top"}, {$set: {hash: blockHash, slot: block.header.slot, height: block.header.height}}, {upsert: true});
        console.info("New Cardano Block",blockHash, block.header.slot,  block.header.height);
    }
}