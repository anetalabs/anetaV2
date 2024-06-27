import BitcoinCore from "bitcoin-core";
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { BIP32Factory } from 'bip32';
import util from 'util';
import fs from 'fs';
import minimist from 'minimist';
import {ECPairFactory}  from 'ecpair'

import * as bip39 from 'bip39';


const args  = minimist(process.argv.slice(2));

const readFile = util.promisify(fs.readFile);

const bitcoinConfig = JSON.parse((await readFile(args.bitcoinConfig || './bitcoinConfig.example.json')).toString());
const secrets = JSON.parse((await readFile(args.secrets || './secrets.example.json')).toString());

async function signTx(txHex){
    const txb = bitcoin.Psbt.fromHex(txHex, {network : bitcoin.networks[bitcoinConfig.network] });
    const ECPair =  ECPairFactory(ecc);

    const seed = bip39.mnemonicToSeedSync(secrets.seed);
    const bip32 = BIP32Factory(ecc);
    const root = bip32.fromSeed(seed);
    const path = "m/44'/0'/0'/0/0"; // This is the BIP44 path for the first address in the first account of a Bitcoin wallet
    const node = root.derivePath(path);

   
    const watcherKey = ECPair.fromPrivateKey(Buffer.from(node.privateKey.toString('hex'),'hex'), { network: bitcoin.networks[bitcoinConfig.network] })
    txb.signAllInputs(watcherKey);
    console.log("signed Tx:", txb.toHex());

}




async function main() {
    signTx(args.txHex)
 }
main();
//# sourceMappingURL=newMigrationBtcTx.js.map