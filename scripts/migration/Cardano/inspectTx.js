import * as LucidEvolution from '@lucid-evolution/lucid'
import fs from 'fs';
import util from 'util';
import { U5C as UTXORpcProvider } from "@utxorpc/lucid-evolution-provider";
import minimist from 'minimist';


const args  = minimist(process.argv.slice(2));


const MultisigDescriptorSchema = LucidEvolution.Data.Object({ 
    list: LucidEvolution.Data.Array(LucidEvolution.Data.Bytes()),
    m: LucidEvolution.Data.Integer(),
  });


  

const readFile = util.promisify(fs.readFile);

async function main(){
    let warnings = ""
    const config = JSON.parse((await readFile('../config/cardanoConfig.json')).toString());
    const protocolConfig = JSON.parse((await readFile('../config/protocolConfig.json')).toString());
    const adminToken = protocolConfig.adminToken;
    const adminPolicyLength = 56 ; // Cardano native asset policy ID length in bytes is 28, which is 56 hex characters
    const adminPolicy = adminToken.slice(0, adminPolicyLength);
    const adminTokenName = adminToken.slice(adminPolicyLength);
    const tx = args.txHex;
    const txDetails = LucidEvolution.CML.Transaction.from_cbor_hex(tx);
    if(txDetails.body().outputs().get(0).amount().multi_asset().get_assets(LucidEvolution.CML.ScriptHash.from_hex(adminPolicy)).get(LucidEvolution.CML.AssetName.from_hex(adminTokenName)) === 1n){
        console.log("!!!!!!Config Update Tx!!!!!!!");
        const newconfig = txDetails.body().outputs().get(0).datum().to_js_value().Datum.datum;
        const fields = newconfig.get('fields');
        const newSigners = fields[0].get('list').map((item) => item.get('bytes'));
        const newM = fields[1].get('int');
        console.log("New Signers:", newSigners , "New M:", newM["$serde_json::private::Number"]);
      }
    // const newconfig = txDetails.body().outputs().get(0).datum().to_js_value().Datum.datum;
    // const fields = newconfig.get('fields');
    // const newSigners = fields[0].get('list').map((item) => item.get('bytes'));
    // const newM = fields[1].get('int');
    // console.log(txDetails.to_json());
    // console.log("New Signers:", newSigners , "New M:", newM);
}


main()
