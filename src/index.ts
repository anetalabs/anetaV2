import { cardanoWatcher } from "./cardano.js"
import { bitcoinWatcher } from "./bitcoin.js";
import { notificationManager } from "./notifications.js";
import { coordinator } from "./coordinator.js";
import { Communicator } from "./comunicator.js";
import minimist from 'minimist';
import fs from 'fs';
import util from 'util';

const args  = minimist(process.argv.slice(2));

console.log(args);

async function main() {
    const readFile = util.promisify(fs.readFile);
    const cardanoConfig = JSON.parse((await readFile(args.cardanoConfig || './cardanoConfig.example.json')).toString());
    const bitcoinConfig = JSON.parse((await readFile(args.bitcoinConfig || './bitcoinConfig.example.json')).toString());
    const notificationConfig = JSON.parse((await readFile(args.notificationConfig || './notificationConfig.example.json')).toString());
    const topology =  JSON.parse((await readFile(args.topology || './topology.example.json')).toString());
    const secrets = JSON.parse((await  readFile(args.secrets || './secrets.example.json')).toString() );
    //const communicator = new Communicator(topology, secrets, args.port || 3000)
    const notification = new notificationManager(notificationConfig)
    const watcher = new bitcoinWatcher(bitcoinConfig, topology, secrets)
    const ADAWatcher = new cardanoWatcher(cardanoConfig, topology, secrets)
    const coord = new coordinator(ADAWatcher, watcher)

       // while(!watcher.inSycn()){
       //     await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL));
        //}
        
        //console.log(watcher.getUtxosByIndex(1))
        try{
          
        } catch (e) {
            console.log(e)
        }
}   

main()

