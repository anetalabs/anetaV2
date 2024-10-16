import * as LucidEvolution from '@lucid-evolution/lucid'
import fs from 'fs';
import util from 'util';
import { U5C as UTXORpcProvider } from "@utxorpc/lucid-evolution-provider";
const readFile = util.promisify(fs.readFile);
import axios from 'axios';

async function main(){
    const tx = process.argv[2];
    const signatures =  process.argv.slice(3);
    const config = JSON.parse((await readFile('../../../config/cardanoConfig.json')).toString());
    const network = config.network.charAt(0).toUpperCase() + config.network.slice(1);
    const lucid = await LucidEvolution.Lucid(new UTXORpcProvider({url: config.utxoRpc.host, headers: config.utxoRpc.headers}), network);
    const signedTx = LucidEvolution.makeTxSignBuilder(lucid.config(), LucidEvolution.CML.Transaction.from_cbor_hex(tx));
    lucid.selectWallet.fromAddress("addr_test1qrlmv3gjf253v49u8v5psxzwtlf6uljc5xf3a24ehfzcyz32ptyyevm796lgrkz2t5vrx3snmmsfh0ntc333mqf6eagstyc95m", []);
    const completeTx = await signedTx.assemble(signatures).complete()
    const txSubmit = await axios.post( config.lucid.provider.host +"/tx/submit", Buffer.from(completeTx.toCBOR(), 'hex'), {headers: {"project_id": config.lucid.provider.projectId, "Content-Type": "application/cbor"}})   
    console.log("Tx was submitted", txSubmit);
    //const txSubmit = await lucid.config().provider.submitTx(completeTx.toCBOR());
   // console.log(txSubmit);
    //console.log(signatures);
}

main()