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
    console.log("configUtxo", configUtxo);
    tx.readFrom([configUtxo]);
    const cBTCName = LucidEvolution.mintingPolicyToId({ "type" : "PlutusV3", "script" :  protocolConfig.contract}) + "63425443";
    const assets = {  }
    assets[cBTCName] = BigInt(args.amount);
    tx.mintAssets(assets, LucidEvolution.Data.void());
    if(args.metadata){
        console.log("metadata", args.metadata);
        const policyId = LucidEvolution.mintingPolicyToId({ "type" : "PlutusV3", "script" :  protocolConfig.contract});
        
        // Validate and parse the metadata
        let metadataContent;
        try {
            metadataContent = JSON.parse(args.metadata);
            if (typeof metadataContent !== 'object' || metadataContent === null) {
                throw new Error('Metadata must be a valid JSON object');
            }
        } catch (error) {
            console.error('Invalid metadata format. Please provide valid JSON:', error.message);
            process.exit(1);
        }

        const fullMetadata = {
            "721": {
                [policyId]: {
                    "cBTC": metadataContent
                }
            }
        };
        tx.attachMetadata(721, fullMetadata);
    }


    tx.attach.Script({ "type" : "PlutusV3", "script" :  protocolConfig.contract})
    const completeTx = await tx.complete({setCollateral: BigInt(4_000_000)});
    console.log(completeTx.toCBOR());
}   


main();

