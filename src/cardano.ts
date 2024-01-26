import * as config from '../config.json';
import { MongoClient } from "mongodb";
import WebSocket from 'ws';
import lucid from 'lucid-cardano'



export class cardanoWatcher{
    mongo: MongoClient;
    ogmiosClient: WebSocket;


    constructor(){
        this.mongo = new MongoClient(config.Cardano.mongo.connectionString);

        this.ogmiosClient =  new WebSocket(config.Cardano.ogmios.host);

        console.log("cardano watcher")
    }

    rpc(method, params, id) {
        this.ogmiosClient.send(JSON.stringify({
            jsonrpc: "2.0",
            method,
            params,
            id
        }));
    }
}
