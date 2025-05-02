import * as LucidEvolution from '@lucid-evolution/lucid'
import fs from 'fs';
import util from 'util';
import minimist from 'minimist';
import { Blockfrost } from '@lucid-evolution/lucid';
const args  = minimist(process.argv.slice(2));




const readFile = util.promisify(fs.readFile);

async function main(){
    const tx = args.txHex;

    const config = JSON.parse((await readFile('../config/cardanoConfig.json')).toString());
    const seed = JSON.parse((await readFile('../config/secrets.json')).toString());
    const scriptConfig = JSON.parse((await readFile('./scriptsConfig.json')).toString());
    const provider = new Blockfrost(scriptConfig[config.network].blockfrost.url, scriptConfig[config.network].blockfrost.key)   
    const lucid = await LucidEvolution.Lucid(provider, config.network);
    lucid.selectWallet.fromSeed(seed.seed);
    const signature = (await lucid.wallet().signTx(LucidEvolution.CML.Transaction.from_cbor_hex(tx))).to_cbor_hex();
    console.log("Signature: ");
    console.log(signature);

}

main()
