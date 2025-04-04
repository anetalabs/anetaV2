//import CoinKey from 'coinkey'; 
import { Lucid , generateSeedPhrase, getAddressDetails } from '@lucid-evolution/lucid';
import * as bip39 from 'bip39';
import {BIP32Factory} from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { U5C as UTXORpcProvider } from "@utxorpc/lucid-evolution-provider";
import fs from 'fs';
import util from 'util';
const readFile = util.promisify(fs.readFile);

async function main(){
    const config = JSON.parse((await readFile('../config/cardanoConfig.json')).toString());

    const seedPhrase  = generateSeedPhrase()
    const provider = new UTXORpcProvider({url: config.utxoRpc.host, headers: config.utxoRpc.headers})
    
    const network = (config.network.charAt(0).toUpperCase() + config.network.slice(1));
    const lucid = await Lucid(provider, network)
    lucid.selectWallet.fromSeed(seedPhrase)
    const AdaPubkey = getAddressDetails(await lucid.wallet().address()).paymentCredential.hash


    const seed = bip39.mnemonicToSeedSync(seedPhrase);
    const bip32 = BIP32Factory(ecc);
    const root = bip32.fromSeed(seed);
    const path = "m/44'/0'/0'"; 
    const node = root.derivePath(path);

    const BtcPublicKey = node.neutered().toBase58()

    const topologyEntry = {"name": "<NAME>","ip": "<IP_ADDRESS>" , "AdaPkHash" : AdaPubkey, "btcKey" : BtcPublicKey}
    console.log("topology Entrie:",  JSON.stringify(topologyEntry))
    console.log("seedPhrase:", seedPhrase)
}


main()



/// Optional update to change the way we do address derivation

// import * as bitcoin from 'bitcoinjs-lib';
// import * as bip32 from 'bip32';

// // Assume seed is your HD wallet seed
// let seed = 'your seed here';

// // Create a BIP32 root key from the seed
// let root = bip32.fromSeed(Buffer.from(seed, 'hex'));

// // Assume m is the number of signatures required and pubkeys is an array of public keys
// let m = 2;
// let pubkeys = [];

// // Generate a unique public key for each address
// for (let i = 0; i < 3; i++) {
//     let child = root.derivePath(`m/44'/0'/0'/${i}`);
//     pubkeys.push(child.publicKey);
// }

// // Create a payment object
// let payment: bitcoin.Payment = {
//     m: m,
//     n: pubkeys.length,
//     pubkeys: pubkeys,
//     network: bitcoin.networks.bitcoin
// };

// // Get the payment address
// let address = bitcoin.payments.p2sh(payment).address;

// console.log(address);