import config from '../config.json' assert { type: 'json' };
import { MongoClient } from "mongodb";
import * as Lucid  from 'lucid-cardano'



export class cardanoWatcher{
    mongo: MongoClient;
    ogmiosClient: WebSocket;
    lucid: Lucid.Lucid;

    constructor(){
        this.mongo = new MongoClient(config.Cardano.mongo.connectionString);

        this.ogmiosClient =  new WebSocket(config.Cardano.ogmios.host);
        (async () => {
            this.lucid = await Lucid.Lucid.new(new Lucid.Blockfrost(config.Cardano.lucid.provider.host, config.Cardano.lucid.provider.projectId ), (config.Cardano.network.charAt(0).toUpperCase() + config.Cardano.network.slice(1)) as Lucid.Network);
        })();

        console.log("cardano watcher")
    }

}
