import BitcoinCore from "bitcoin-core"
import * as bitcoin from 'bitcoinjs-lib';
import ECPairFactory  from 'ecpair'
import * as ecc  from 'tiny-secp256k1'
import * as config from '../config.json';
import { isAsyncFunction } from "util/types";
import { compile } from "bitcoinjs-lib/src/script";
import { EventEmitter } from 'events';

const ECPair =  ECPairFactory(ecc);
export const utxoEventEmitter = new EventEmitter();

type addressUtxos = {
    index: number,
    address: string,
    utxos: utxo[]
}

type utxo = {
    txid: string,
    vout: number,
    scriptPubKey: string,
    amount: number,
    height: number
}

export class bitcoinWatcher{
    client: BitcoinCore;
    address: string[];
    utxos: addressUtxos[];
    isSynced: boolean = false;
    watcherKey: any; 
    constructor(){
        this.client = new BitcoinCore(config.bitcoinRPC);
        this.address =  Array.from({length: config.paymentPaths}, (_, index) => index).map((index) => this.getAddress(index))
        this.watcherSync()
        this.watcherKey = ECPair.fromPrivateKey(Buffer.from(config.BTCPrivKey,'hex'), { network: bitcoin.networks[config.network] })

    }

    startListener = async () => {
        let lastHeight = await this.getHeight();
        console.log(lastHeight);

        setInterval(async () => {
            const currentHeight = await this.getHeight();
            if (currentHeight !== lastHeight) {
                console.log("new BTC block: ",currentHeight);
                lastHeight = currentHeight;
                await this.getUtxos()
                
            }
        }, 10000); // Check every 5 seconds
    }

    getHeight = async () => {
        const height = await this.client.getBlockCount()
        return height
    }

    watcherSync = async () => {
        const isSynced = await this.isNodeSynced();
        while (!isSynced) {
            console.log('Bitcoin Node is not synced');
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
        await this.getUtxos();
        this.startListener()
        this.isSynced = true;
    };

    getUtxosByIndex = (index: number) => {
        return this.utxos[index].utxos;
    }

    inSycn =  () => {
        return this.isSynced;
    }

    isNodeSynced = async () => {
        const info = await this.client.command('getblockchaininfo');
        const isSynced = info.headers === info.blocks;
        return isSynced;
    }

    reddemIndex = async (indexs: number[]) => {
        const txb = new bitcoin.Psbt({network : bitcoin.networks[config.network] });
        let total = 0;
        let txSize = 10 + 34;
        const nonWitnessData = 41;
        const witnessData = config.m * 73 + config.guardiansAngels.length * 34 + 3 + config.m + config.guardiansAngels.length * 34 + 1;
        const inputSize = nonWitnessData + Math.ceil(witnessData / 4);   


        indexs.map((index) => {
            if (index >= this.utxos.length || index <= 0) throw new Error('Index out of range');

            const addressUtxos = this.utxos[index].utxos;
            const redeemScript = Buffer.from(this.getRedeemScript(index), 'hex');

        for (let i = 0; i < addressUtxos.length; i++) {
            total += Math.round(addressUtxos[i].amount * 100000000) ;
            txb.addInput({
                hash: addressUtxos[i].txid,
                index: addressUtxos[i].vout,
                witnessUtxo: {
                    script: Buffer.from(addressUtxos[i].scriptPubKey, 'hex'),
                    value: Math.round(addressUtxos[i].amount * 100_000_000),
                },
                witnessScript: redeemScript,
            });
        }
        txSize += addressUtxos.length * inputSize;
        });

        if (total === 0) throw new Error('No UTXOs to redeem');
        console.log(txSize);
        const feerate = await this.getFee();
    
        console.log(feerate);
        const fee = Math.round( 100_000 * feerate  * txSize) ; //round to 8 decimal places 
        console.log(fee,total);   
        const amount = total - fee;
        
        txb.addOutput({address: this.address[0], value: amount });

        txb.signAllInputs(this.watcherKey);
        txb.finalizeAllInputs();
        const tx = txb.extractTransaction();

        const txHex = tx.toHex();
        const resault = await this.client.sendRawTransaction(txHex);
        console.log(resault);
        
    }

    refundIndex = (index: number) => {

    }
    
    getFee = async () => {  
        const fee = await this.client.estimateSmartFee(100)
        return fee.feerate;
    }

    getUtxos = async () => {
        const descriptors = this.address.map(address => ({ 'desc': `addr(${address})`, 'range': 1000 }));
        const height = await this.getHeight()
        await this.client.command('scantxoutset', 'abort', descriptors)
        const resault =  await this.client.command('scantxoutset', 'start', descriptors)
        const utxosRaw =  resault.unspents.map((utxo) => Object.assign( {}, utxo)).filter((utxo) => utxo.height <= height - config.BTCFinality);
        // Organize utxos by address
        const utxosByAddress = utxosRaw.reduce((acc, utxo) => {
            const address = utxo.desc.split('(')[1].split(')')[0];
            if (acc[address] === undefined) {
                acc[address] = [];
            }
            acc[address].push(utxo);
            return acc;
        }, {});

        this.utxos = this.address.map((address, index) => ({
            index,
            address,
            utxos: utxosByAddress[address] || []
        }));
        this.utxos.map((address) => console.log(address.utxos))
    }

    getAddress(index: number){
        const HexKeys =  config.guardiansAngels.map((guardian) => guardian.btcKey);
        if (index !== 0) HexKeys.push(this.fillerKey(index));
        const pubkeys = HexKeys.map(key => Buffer.from(key, 'hex'));
        const p2shAddress = bitcoin.payments.p2wsh({
            redeem: bitcoin.payments.p2ms({ m: config.m , pubkeys ,
            network: bitcoin.networks[config.network], }),
            network: bitcoin.networks[config.network],
        });
    
        return p2shAddress.address; 
    }
        
    getRedeemScript(index: number){

        const HexKeys =  config.guardiansAngels.map((guardian) => guardian.btcKey);
        if (index !== 0) HexKeys.push(this.fillerKey(index));
        const pubkeys = HexKeys.map(key => Buffer.from(key, 'hex'));
        const p2shAddress = bitcoin.payments.p2wsh({
            redeem: bitcoin.payments.p2ms({ m: config.m , pubkeys ,
            network: bitcoin.networks[config.network], }),
            network: bitcoin.networks[config.network],
        });
        return p2shAddress.redeem.output.toString('hex');
    }



    fillerKey(index: number){
        const indexHex = "0300000000000000000000000000000000000000000000000000000000" + index.toString(16).padStart(8, '0');
        return indexHex;
    }
}



