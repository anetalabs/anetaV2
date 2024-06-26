import { CardanoWatcher } from "./cardano.js"
import { BitcoinWatcher } from "./bitcoin.js";
import { NotificationManager } from "./notifications.js";
import { Coordinator } from "./coordinator.js";
import { Communicator } from "./comunicator.js";
import ApiServer from "./api.js";
import { cardanoConfig, bitcoinConfig, notificationConfig, topology, secretsConfig, protocolConfig } from "./types.js";
import minimist from 'minimist';
import fs from 'fs';
import util from 'util';
import { connect } from './db.js';

// Now your other modules can use the MongoDB connection
const args  = minimist(process.argv.slice(2));

export let communicator: Communicator;
export let notification: NotificationManager;
export let BTCWatcher: BitcoinWatcher;
export let ADAWatcher: CardanoWatcher;
export let coordinator: Coordinator;

console.log(args);

async function main() {
    
    const readFile = util.promisify(fs.readFile);
    const cardanoConfig : cardanoConfig = JSON.parse((await readFile(args.cardanoConfig || './cardanoConfig.example.json')).toString());
    const bitcoinConfig : bitcoinConfig = JSON.parse((await readFile(args.bitcoinConfig || './bitcoinConfig.example.json')).toString());
    const notificationConfig : notificationConfig = JSON.parse((await readFile(args.notificationConfig || './notificationConfig.example.json')).toString());
    const topology : topology =  JSON.parse((await readFile(args.topology || './topology.example.json')).toString());
    const secrets : secretsConfig= JSON.parse((await  readFile(args.secrets || './secrets.example.json')).toString() );
    const protocolConfig : protocolConfig = JSON.parse((await readFile(args.protocolConfig || './protocolConfig.example.json')).toString());
    const server = new ApiServer();
    server.start(args.apiPort || 3030);

    connect(cardanoConfig.mongo.connectionString);



    //////////////////////////////////////////////////////
    communicator = new Communicator(topology, secrets, args.port || 3000)
    notification = new NotificationManager(notificationConfig)
    BTCWatcher = new BitcoinWatcher(bitcoinConfig, topology, secrets);
    ADAWatcher = new CardanoWatcher(cardanoConfig,  secrets);
    coordinator = new Coordinator( protocolConfig);
    
    // while(!watcher.inSycn()){
    //     await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL));
    //}

    //console.log(watcher.getUtxosByIndex(1))
    try {
      
    } catch (e) {
        console.log(e);
    }
}   

main()

