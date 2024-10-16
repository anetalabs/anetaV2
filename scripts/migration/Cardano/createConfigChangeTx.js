import * as LucidEvolution from '@lucid-evolution/lucid'
import fs from 'fs';
import util from 'util';
import { U5C as UTXORpcProvider } from "@utxorpc/lucid-evolution-provider";


const MultisigDescriptorSchema = LucidEvolution.Data.Object({ 
    list: LucidEvolution.Data.Array(LucidEvolution.Data.Bytes()),
    m: LucidEvolution.Data.Integer(),
  });
  

const readFile = util.promisify(fs.readFile);

async function main(){
    const config = JSON.parse((await readFile('../../../config/cardanoConfig.json')).toString());
    const protocolConfig = JSON.parse((await readFile('../../../config/protocolConfig.json')).toString());
    const signers = process.argv[2].replaceAll('[', '').replaceAll(']', '').split(',');
    console.log(signers);
    const newMembers = process.argv[3].replaceAll('[', '').replaceAll(']', '').split(','); 
    console.log(newMembers); 
    const newM = parseInt(process.argv[4]); 
    console.log(newM);
    const network = (config.network.charAt(0).toUpperCase() + config.network.slice(1));
    const lucid = await LucidEvolution.Lucid(new UTXORpcProvider({url: config.utxoRpc.host, headers: config.utxoRpc.headers}), network);
    const configUtxo = await lucid.config().provider.getUtxoByUnit(protocolConfig.adminToken);
    const walletUtxos =  await lucid.config().provider.getUtxos({ type: "Key", hash: signers[0] });
    lucid.selectWallet.fromAddress( walletUtxos[0].address, walletUtxos);
    const tx = await lucid.newTx();
    for (const signer of signers) {
        tx.addSignerKey(signer);
    }
    tx.collectFrom([configUtxo], LucidEvolution.Data.void());
    
    const data = LucidEvolution.Data.to({ list: newMembers , m: BigInt(newM) }, MultisigDescriptorSchema);
    const address = LucidEvolution.validatorToAddress(network,{ "type" : "PlutusV3", "script" :  protocolConfig.configHostContract})

    tx.pay.ToContract(address, { "kind" : "inline", "value" : data}, configUtxo.assets)
    tx.attach.Script({ "type" : "PlutusV3", "script" :  protocolConfig.configHostContract})
    console.log(configUtxo);
    console.log(walletUtxos);
    const completeTx = await tx.complete();
    console.log(completeTx.toCBOR());
}   


main();

