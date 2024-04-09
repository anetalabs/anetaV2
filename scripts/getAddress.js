import { bitcoinWatcher } from "../dist/bitcoin.js";
import fs from 'fs';
import minimist from 'minimist';

import util from 'util';
const args  = minimist(process.argv.slice(2));


async function main() {
    const readFile = util.promisify(fs.readFile);

    const bitcoinConfig =   JSON.parse((await readFile(args.bitcoinConfig || '../bitcoinConfig.example.json')).toString());
    const topology =  JSON.parse((await readFile(args.topology || '../topology.example.json')).toString());
    const secrets = JSON.parse((await  readFile(args.secrets || '../secrets.example.json')).toString() );
    const watcher = new bitcoinWatcher(bitcoinConfig, topology, secrets);

    console.log(getAddress(secrets, watcher));
}

main()