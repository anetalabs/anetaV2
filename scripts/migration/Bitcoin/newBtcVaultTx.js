import BitcoinCore from "bitcoin-core";
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { BIP32Factory } from 'bip32';
import util from 'util';
import fs from 'fs';
import minimist from 'minimist';



const args  = minimist(process.argv.slice(2));

const readFile = util.promisify(fs.readFile);

const topology = JSON.parse((await readFile(args.topology || '../config/topology.json')).toString());
const bitcoinConfig = JSON.parse((await readFile(args.bitcoinConfig || '../config/bitcoinConfig.json')).toString());

const client = new BitcoinCore(bitcoinConfig.bitcoinRPC);


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

async function getUtxos() {
    try {
        const descriptors = [];
        descriptors.push({ 'desc': `addr(${getVaultAddress()})`, 'range': 1000 });
        await client.command('scantxoutset', 'abort', descriptors);
        const resault = await client.command('scantxoutset', 'start', descriptors);
        const utxosRaw = resault.unspents.map((utxo) => Object.assign({}, utxo));
        console.log("address", getVaultAddress());
        console.log("Vault", utxosRaw);
        return utxosRaw;
    }
    catch (e) {
        console.log(e);
    }
}
function getVaultAddress() {
    const HexKeys = topology.topology.map((guardian, guardianIndex) => {
        const bip32 = BIP32Factory(ecc);
        const parent = bip32.fromBase58(guardian.btcKey);
        const child = parent.derive(0);
        return child.derive(0).publicKey.toString('hex');
    });
    const pubkeys = HexKeys.map(key => Buffer.from(key, 'hex'));
    const p2shAddress = bitcoin.payments.p2wsh({
        redeem: bitcoin.payments.p2ms({ m: topology.m, pubkeys,
            network: bitcoin.networks[bitcoinConfig.network], }),
        network: bitcoin.networks[bitcoinConfig.network],
    });
    return p2shAddress.address;
}

async function craftTransaction(utxos)  {
        const txb = new bitcoin.Psbt({network : bitcoin.networks[bitcoinConfig.network] });
        const outputs = args.aamount ? 2 : 1;
        let total = 0;
        let txSize = 10 + 34 * outputs
        const nonWitnessData = 41;
        const witnessData = topology.m * 73 + topology.topology.length * 34 + 3 + topology.m + topology.topology.length * 34 + 1;
        const inputSize = nonWitnessData + Math.ceil(witnessData / 4);
        const redeemScript = Buffer.from(getVaultRedeemScript(), 'hex');
        for (let i = 0; i < utxos.length; i++) {
            total += Math.round(utxos[i].amount * 100000000) ;
            txb.addInput({
                hash: utxos[i].txid,
                index: utxos[i].vout,
                witnessUtxo: {
                    script: Buffer.from(utxos[i].scriptPubKey, 'hex'),
                    value: Math.round(utxos[i].amount * 100_000_000),
                },
                witnessScript: redeemScript,
            });
        }


        txSize += utxos.length * inputSize;
        console.log(txSize)
        if (total === 0) throw new Error('No UTXOs to redeem');
        const feerate =  await client.estimateSmartFee(100)
        const fee = Math.round( 100_000 * 0.00001  * txSize ) ; //round to 8 decimal places
        console.log("Fee: ", fee);
        console.log("feerate: ", feerate);
        console.log("Total: ", total);
        if (args.amount){
            const amount = Math.round(args.amount * 100000000);
            txb.addOutput({ address: args.targetAddress, value: amount });
            txb.addOutput({address: getVaultAddress(), value: total - amount - fee });
        }else{
            txb.addOutput({ address: args.targetAddress, value: total - fee });
        }
        

        console.log("Tx: ", txb.toString());
        
    
        return txb
  

}



async function main() {
    if(!args.targetAddress) throw new Error("Target address is required")

    const utxos = await getUtxos();
    const tx = await craftTransaction(utxos);
    
    console.log(tx.toHex());
}
main();
//# sourceMappingURL=newMigrationBtcTx.js.map