//import CoinKey from 'coinkey'; 
import { Lucid, getAddressDetails  } from '@lucid-evolution/lucid';
import * as bip39 from 'bip39';
import {BIP32Factory} from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { U5C as UTXORpcProvider } from "@utxorpc/lucid-evolution-provider";
import fs from 'fs';
import util from 'util';
const readFile = util.promisify(fs.readFile);

async function main(){
    const seedPhrase =  process.argv[2]; //argument from command line
    const config = JSON.parse((await readFile('../config/cardanoConfig.json')).toString());
    const provider = new UTXORpcProvider({url: config.utxoRpc.host, headers: config.utxoRpc.headers})
    const network = (config.network.charAt(0).toUpperCase() + config.network.slice(1));
    const lucid = await Lucid(provider, network)
    lucid.selectWallet.fromSeed(seedPhrase)
    const AdaPubkey = getAddressDetails(await lucid.wallet().address()).paymentCredential.hash


    const seed = bip39.mnemonicToSeedSync(seedPhrase);
    const bip32 = BIP32Factory(ecc);
    const root = bip32.fromSeed(seed);
    const path = "m/44'/0'/0'"; // This is the BIP44 path for the first address in the first account of a Bitcoin wallet
    const node = root.derivePath(path);

    const BtcPublicKey = node.neutered().toBase58()



    const topologyEntry = {"name": "<NAME>","ip": "<IP_ADDRESS>" , "AdaPkHash" : AdaPubkey, "btcKey" : BtcPublicKey}
    console.log("topology Entrie:",  JSON.stringify(topologyEntry))
}


main()


