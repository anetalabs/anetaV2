import BitcoinCore from "bitcoin-core";
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { BIP32Factory } from 'bip32';
import util from 'util';
import fs from 'fs';
import minimist from 'minimist';



const args  = minimist(process.argv.slice(2));

const readFile = util.promisify(fs.readFile);

const bitcoinConfig = JSON.parse((await readFile(args.bitcoinConfig || '../../../config/bitcoinConfig.json')).toString());

function combine(psbt1, psbt2) {
    const txb1 = psbt1
    const txb2 = bitcoin.Psbt.fromHex(psbt2, {network : bitcoin.networks[bitcoinConfig.network] });
    const txb = txb1.combine(txb2);
    return txb;
}

function getVaultRedeemScript(){
    const HexKeys =  topology.topology.map((guardian) => {
        const bip32 = BIP32Factory(ecc);
        const parent = bip32.fromBase58(guardian.btcKey);
        const child = parent.derive(0);
        return child.derive(0).publicKey.toString('hex'); 
    });

    const pubkeys = HexKeys.map(key => Buffer.from(key, 'hex'));
    const p2shAddress = bitcoin.payments.p2wsh({
        redeem: bitcoin.payments.p2ms({ m: topology.m , pubkeys ,
        network: bitcoin.networks[bitcoinConfig.network], }),
        network: bitcoin.networks[bitcoinConfig.network],
    });
    return p2shAddress.redeem.output.toString('hex');
}

    
async function completeAndSubmit(txb) {
    const client = new BitcoinCore(bitcoinConfig.bitcoinRPC);

    txb.finalizeAllInputs();
    const tx = txb.extractTransaction();
    const txHex = tx.toHex();
    return await client.sendRawTransaction(txHex);
  
}

async function main() {
    const rawTxs = args.txHex 
    const basePstb = bitcoin.Psbt.fromHex(rawTxs[0], {network : bitcoin.networks[bitcoinConfig.network] });
    const signedTx = rawTxs.slice(1).reduce((acc, psbt) => combine(acc, psbt), basePstb);
    console.log("signed Tx:", signedTx.toHex());
    const txid = await completeAndSubmit(signedTx);
    console.log("txid:", txid);

}
main();
//# sourceMappingURL=newMigrationBtcTx.js.map