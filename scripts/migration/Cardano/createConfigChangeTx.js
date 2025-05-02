import * as LucidEvolution from '@lucid-evolution/lucid'
import fs from 'fs';
import util from 'util';
import minimist from 'minimist';
import { Blockfrost } from '@lucid-evolution/lucid';

const args  = minimist(process.argv.slice(2));


const MultisigDescriptorSchema = LucidEvolution.Data.Object({ 
    list: LucidEvolution.Data.Array(LucidEvolution.Data.Bytes()),
    m: LucidEvolution.Data.Integer(),
  });
  

const readFile = util.promisify(fs.readFile);

async function main(){
    const config = JSON.parse((await readFile('../config/cardanoConfig.json')).toString());
    const protocolConfig = JSON.parse((await readFile('../config/protocolConfig.json')).toString());
    const scriptConfig = JSON.parse((await readFile('./scriptsConfig.json')).toString());
    const signers = args.signers.trim().replaceAll('[', '').replaceAll(']', '').split(',');
    const newMembers = args.newMembers.trim().replaceAll('[', '').replaceAll(']', '').split(','); 
    const newM = parseInt(args.newM); 
    const network = (config.network.charAt(0).toUpperCase() + config.network.slice(1));
    const provider = new Blockfrost(scriptConfig[config.network].blockfrost.url, scriptConfig[config.network].blockfrost.key)
    const lucid = await LucidEvolution.Lucid(provider, network);
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
    const assets = {"lovelace" : 2000000 }
    assets[protocolConfig.adminToken] = 1
    tx.pay.ToContract(address, { "kind" : "inline", "value" : data}, assets)
    tx.attach.Script({ "type" : "PlutusV3", "script" :  protocolConfig.configHostContract})
    const completeTx = await tx.complete({localUPLCEval: false});
    console.log(completeTx.toCBOR());
}   


main();

