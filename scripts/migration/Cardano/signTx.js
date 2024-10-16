import * as LucidEvolution from '@lucid-evolution/lucid'
import fs from 'fs';
import util from 'util';
import { U5C as UTXORpcProvider } from "@utxorpc/lucid-evolution-provider";
const readFile = util.promisify(fs.readFile);

async function main(){
    const tx = process.argv[2];
    const config = JSON.parse((await readFile('../../../config/cardanoConfig.json')).toString());
    const seed = JSON.parse((await readFile('../../../config/secrets.json')).toString());
    const lucid = await LucidEvolution.Lucid(new UTXORpcProvider({url: config.utxoRpc.host, headers: config.utxoRpc.headers}), config.network);
    lucid.selectWallet.fromSeed(seed.seed);
    const signature = (await lucid.wallet().signTx(LucidEvolution.CML.Transaction.from_cbor_hex(tx))).to_cbor_hex();
    console.log(signature);

}

main()
