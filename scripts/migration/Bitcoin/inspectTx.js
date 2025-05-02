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
const topology = JSON.parse((await readFile(args.topology || '../config/topology.json')).toString());

function addressIsVault(address){
    return address === getVaultAddress();
}

function getVaultAddress(){
    const HexKeys =  topology.topology.map((guardian , guardianIndex) => {
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

    return p2shAddress.address; 
}

async function decodeRawTransaction(txHex) {
    const txb = bitcoin.Psbt.fromHex(txHex, {network : bitcoin.networks[bitcoinConfig.network] });

    let totalInputValue = 0;
    let totalOutputValue = 0;
    let valueSpent = 0;

    console.log("///////////////////// INPUTS /////////////////////////");
    txb.data.inputs.forEach((input, idx) => {
        const utxo = input.witnessUtxo;
        console.log(`Input #${idx + 1}:`);
        if (utxo) {
            console.log(`  Value: ${utxo.value / 1e8} BTC`);
            console.log(`  ScriptPubKey: ${utxo.script.toString('hex')}`);
        } else {
            console.log("  No witnessUtxo data available.");
        }
        totalInputValue += utxo ? utxo.value : 0;
        valueSpent += utxo ? utxo.value : 0;
    });

    console.log("\n///////////////////// OUTPUTS /////////////////////////");
    txb.txOutputs.forEach((output, idx) => {
        console.log(`Output #${idx + 1}:`);
        console.log(`  Value: ${output.value / 1e8} BTC`);
        try {
            const address = bitcoin.address.fromOutputScript(output.script, bitcoin.networks[bitcoinConfig.network]);
            console.log(`  Address: ${address}`);
            if(addressIsVault(address)){
                valueSpent -= output.value;
                console.log("  Vault address: True");
            }
            else{
                console.log("  Vault address: False");
            }
        } catch (e) {
            console.log(`  Script: ${output.script.toString('hex')}`);
        }
    });

    txb.txOutputs.forEach(output => {
        totalOutputValue += output.value;
    });

    console.log("\n///////////////////// SUMMARY /////////////////////////");
    console.log(`Total Input Value:  ${totalInputValue / 1e8} BTC`);
    console.log(`Total Spent:        ${valueSpent / 1e8} BTC`);
    console.log(`Fee:                ${(totalInputValue - totalOutputValue) / 1e8} BTC`);
}


async function main() {
    decodeRawTransaction(args.txHex)
 }
main();
//# sourceMappingURL=newMigrationBtcTx.js.map