import BitcoinCore from "bitcoin-core";
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { BIP32Factory } from 'bip32';
import util from 'util';
import fs from 'fs';
import minimist from 'minimist';



const args  = minimist(process.argv.slice(2));

const readFile = util.promisify(fs.readFile);

const bitcoinConfig = JSON.parse((await readFile(args.bitcoinConfig || '../config/bitcoinConfig.json')).toString());

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

async function decodeRawTransaction(txHex) {
    const txb = bitcoin.Psbt.fromHex(txHex, {network : bitcoin.networks[bitcoinConfig.network] });


    let totalInputValue = 0;
    let totalOutputValue = 0;

    console.log("///////////////////// INPUTS /////////////////////////")

    txb.data.inputs.forEach((input) => {
       console.log(input);
       totalInputValue += input.witnessUtxo.value;
    });
    console.log("///////////////////// OUTPUTS /////////////////////////")

    txb.txOutputs.forEach((output) => {
        console.log( output);
        totalOutputValue += output.value;
    });

    console.log("///////////////////// SUMMARY /////////////////////////")

    console.log("Total Input Value: ", totalInputValue);
    console.log("Total Output Value: ", totalOutputValue);
    console.log("Fee: ", totalInputValue - totalOutputValue);
}


async function main() {
    decodeRawTransaction(args.txHex)
 }
main();
//# sourceMappingURL=newMigrationBtcTx.js.map