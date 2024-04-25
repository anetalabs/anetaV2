//import CoinKey from 'coinkey'; 
import { Lucid, Utils } from 'lucid-cardano';
import * as bip39 from 'bip39';
import {BIP32Factory} from 'bip32';
import * as ecc from 'tiny-secp256k1';

async function main(){
  //  const wallet = new CoinKey.createRandom();
   // wallet.privateKey.toString('hex')
   // wallet.publicKey.toString('hex')
    const utils = new Utils()
    const seedPhrase  = utils.generateSeedPhrase()
    const lucid = new Lucid()
    lucid.selectWalletFromSeed(seedPhrase)
    const AdaPubkey = utils.getAddressDetails(await lucid.wallet.address()).paymentCredential.hash


    const seed = bip39.mnemonicToSeedSync(seedPhrase);
    const bip32 = BIP32Factory(ecc);
    const root = bip32. fromSeed(seed);
    const path = "m/44'/0'/0'/0/0"; // This is the BIP44 path for the first address in the first account of a Bitcoin wallet
    const node = root.derivePath(path);

    const BtcPublicKey = node.publicKey.toString('hex');



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