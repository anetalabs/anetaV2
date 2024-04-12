import BitcoinCore from "bitcoin-core"
import * as bitcoin from 'bitcoinjs-lib';
import {ECPairFactory}  from 'ecpair'
import * as ecc  from 'tiny-secp256k1'
import { EventEmitter } from 'events';
import {bitcoinConfig, topology, secretsConfig, decodedRequest} from "./types.js"
import * as bip39 from 'bip39';
import {BIP32Factory} from 'bip32';
import { emitter } from "./coordinator.js";
import { utxo } from "./types.js";
import { hexToString } from "./helpers.js";

const cBTCiD = "95d93745addaa042497bb7bd8a63e1a1f39e848eff857ec0e981c7a963425443"
const ECPair =  ECPairFactory(ecc);
export const utxoEventEmitter = new EventEmitter();

type addressUtxos = {
    index: number,
    address: string,
    utxos: utxo[]
}





export class bitcoinWatcher{
    private client: BitcoinCore;
    private address: string[];
    private utxos: addressUtxos[];
    private isSynced: boolean = false;
    private watcherKey: any; 
    private config: bitcoinConfig ;
    private topology: topology;


    constructor(config : bitcoinConfig, topology : topology, secrets : secretsConfig){
        console.log("bitcoin watcher")
        this.config = config
        this.topology = topology
        this.client = new BitcoinCore(config.bitcoinRPC);
        this.address =  Array.from({length: config.paymentPaths}, (_, index) => index).map((index) => this.getAddress(index))
        console.log(this.address)
        this.watcherSync()

        const seed = bip39.mnemonicToSeedSync(secrets.seed);
        const bip32 = BIP32Factory(ecc);
        const root = bip32. fromSeed(seed);
        const path = "m/44'/0'/0'/0/0"; // This is the BIP44 path for the first address in the first account of a Bitcoin wallet
        const node = root.derivePath(path);

        this.watcherKey = ECPair.fromPrivateKey(Buffer.from(node.privateKey.toString('hex'),'hex'), { network: bitcoin.networks[config.network] })

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
                emitter.emit("newBtcBlock");
                
            }
        }, 5000); // Check every 5 seconds
    }

    getHeight = async () => {
        const height = await this.client.getBlockCount()
        return height
    }

    satToBtc = (sat: number) => {
        return sat / 100_000_000;
    }

    btcToSat = (btc: number) => {
        return btc * 100_000_000;
    }

    watcherSync = async () => {
        const isSynced = await this.isNodeSynced();
        while (!isSynced) {
            console.log('Bitcoin Node is not synced');
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
        await this.getUtxos();
        //////////////////////////
        emitter.emit("newBtcBlock");
        //////////////////////////
        this.startListener()
        this.isSynced = true;
    };

    getUtxosByIndex = (index: number) => {
        try{
            return this.utxos[index].utxos;
        } catch (e) {   
            return [];
        }
    }

    inSycn =  () => {
        return this.isSynced;
    }

    isNodeSynced = async () => {
        const info = await this.client.command('getblockchaininfo');
        const isSynced = info.headers === info.blocks;
        return isSynced;
    }

    withdrawProfits = async (amount: number) => {
        const txb = new bitcoin.Psbt({network : bitcoin.networks[this.config.network] });
        let total = 0;
        let txSize = 10 + 34 * 2; // Replace numOutputs with the number of outputs
        const nonWitnessData = 41;
        const witnessData = this.topology.m * 73 + this.topology.topology.length * 34 + 3 + this.topology.m + this.topology.topology.length * 34 + 1;
        const inputSize = nonWitnessData + Math.ceil(witnessData / 4);
        const utxos = this.utxos[0].utxos;
        const redeemScript = Buffer.from(this.getRedeemScript(0), 'hex');
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
        const feerate = await this.getFee() ;
        const fee = Math.round( 100_000 * feerate  * txSize) ; //round to 8 decimal places
        const amountToSend = total - fee;
        if (amountToSend < amount) throw new Error('Not enough funds');
        txb.addOutput({address: this.address[0], value: total  - amount });
        txb.addOutput({address: this.config.BTCadminAddress, value: amount - fee });
        txb.signAllInputs(this.watcherKey);
        txb.finalizeAllInputs();
        const tx = txb.extractTransaction();
        const txHex = tx.toHex();
        const resault = await this.client.sendRawTransaction(txHex);
        console.log(resault);
    

    }

    craftRedemptionTransaction = async (requests: decodedRequest[]) => {
        while ( this.isSynced === false) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
        
        const txb = new bitcoin.Psbt({network : bitcoin.networks[this.config.network] });
        let total = 0;
        let txSize = 10 + 34 * (requests.length+1)
        const nonWitnessData = 41;
        const witnessData = this.topology.m * 73 + this.topology.topology.length * 34 + 3 + this.topology.m + this.topology.topology.length * 34 + 1;
        const inputSize = nonWitnessData + Math.ceil(witnessData / 4);
        const utxos = this.utxos[this.utxos.length - 1 ].utxos;
        console.log("crafting redemption transaction", requests, utxos);
        const redeemScript = Buffer.from(this.getVaultRedeemScript(), 'hex');
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
        const feerate = await this.getFee() ;
        const fee = Math.round( 100_000 * feerate  * txSize) ; //round to 8 decimal places
        let amountToSend = 0
        
        requests.forEach((request) => {
            console.log("request", hexToString( request.decodedDatum.destinationAddress), request.assets[cBTCiD])
            txb.addOutput({address:hexToString( request.decodedDatum.destinationAddress), value: Number(request.assets[cBTCiD]) });
            amountToSend += Number(request.assets[cBTCiD]);
        });

        txb.addOutput({address: this.getVaultAddress(), value: total - amountToSend - fee });
        
        
        // if (amountToSend < requests.reduce((acc, request) => acc + Number(request.assets[cBTCiD]), 0)) throw new Error('Not enough funds');
      
        return(txb.toHex());
    }

    consolidatePayments = async (indexs: number[]) => {
        try{

        const txb = new bitcoin.Psbt({network : bitcoin.networks[this.config.network] });
        let total = 0;
        let txSize = 10 + 35;
        const nonWitnessData = 41;
        const witnessData = this.topology.m * 73 + this.topology.topology.length * 34 + 3 + this.topology.m + this.topology.topology.length * 34 + 1;
        const inputSize = nonWitnessData + Math.ceil(witnessData / 4);   
        console.log("consolidating payments", indexs);


        indexs.map((index) => {
            if (index >= this.utxos.length - 1 ) throw new Error('Index out of range');

            const addressUtxos = this.utxos[index].utxos;
            console.log("addressUtxos",indexs , addressUtxos)
            const redeemScript = Buffer.from(this.getRedeemScript(index), 'hex');

            
        for (let i = 0; i < addressUtxos.length; i++) {
            console.log("amount", addressUtxos[i].amount)
            total += Math.round(this.btcToSat(addressUtxos[i].amount)) ;
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
        const feerate =   await this.getFee() ;
    
        const fee = Math.round( 100_000 * feerate  * txSize) ; //round to 8 decimal places 
        const amount = total - fee;
        console.log("total", total, "fee", fee, "amount", amount, "txSize", txSize, "feerate", feerate);  
        console.log({address: this.getVaultAddress(), value: amount });
        txb.addOutput({address: this.getVaultAddress(), value: amount });

        txb.signAllInputs(this.watcherKey);
        txb.finalizeAllInputs();
        const tx = txb.extractTransaction();

        const txHex = tx.toHex();
        const resault = await this.client.sendRawTransaction(txHex);
        console.log("consolidation completed", resault);
    } catch (e) {   
        console.log(e)
        throw e;
    }
    }

    refundIndex = (index: number) => {

    }
    
    getFee = async () => {  
        const fee = await this.client.estimateSmartFee(100)
        return fee.feerate ? fee.feerate : this.config.falbackFeeRate;
    }

    getUtxos = async () => {
        try{
        const descriptors = this.address.map(address => ({ 'desc': `addr(${address})`, 'range': 1000 }));
        descriptors.push({ 'desc': `addr(${this.getVaultAddress()})`, 'range': 1000 });
        const height = await this.getHeight()
        await this.client.command('scantxoutset', 'abort', descriptors)
        const resault =  await this.client.command('scantxoutset', 'start', descriptors)
        const utxosRaw =  resault.unspents.map((utxo) => Object.assign( {}, utxo)).filter((utxo) => utxo.height <= height - this.config.Finality);
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
        this.utxos.push({
            index: this.address.length,
            address: this.getVaultAddress(),
            utxos: utxosByAddress[this.getVaultAddress()] || []
        });

        this.utxos.map((address) => console.log(address.utxos))
        console.log("Vault", this.utxos[this.address.length])
        emitter.emit("newBtcBlock");
    } catch (e) {
        console.log(e)
    }
    }

    getVaultAddress(){
        const HexKeys =  this.topology.topology.map((guardian) => guardian.btcKey);
        const pubkeys = HexKeys.map(key => Buffer.from(key, 'hex'));
        const p2shAddress = bitcoin.payments.p2wsh({
            redeem: bitcoin.payments.p2ms({ m: this.topology.m , pubkeys ,
            network: bitcoin.networks[this.config.network], }),
            network: bitcoin.networks[this.config.network],
        });
    
        return p2shAddress.address; 
    }

    getAddress(index: number){
        const HexKeys =  this.topology.topology.map((guardian) => guardian.btcKey);
        HexKeys.push(this.fillerKey(index +1));
        const pubkeys = HexKeys.map(key => Buffer.from(key, 'hex'));
        const p2shAddress = bitcoin.payments.p2wsh({
            redeem: bitcoin.payments.p2ms({ m: this.topology.m , pubkeys ,
            network: bitcoin.networks[this.config.network], }),
            network: bitcoin.networks[this.config.network],
        });
    
        return p2shAddress.address; 
    }
    
    getVaultRedeemScript(){
        const HexKeys =  this.topology.topology.map((guardian) => guardian.btcKey);
        const pubkeys = HexKeys.map(key => Buffer.from(key, 'hex'));
        const p2shAddress = bitcoin.payments.p2wsh({
            redeem: bitcoin.payments.p2ms({ m: this.topology.m , pubkeys ,
            network: bitcoin.networks[this.config.network], }),
            network: bitcoin.networks[this.config.network],
        });
        return p2shAddress.redeem.output.toString('hex');
    }

    getRedeemScript(index: number){

        const HexKeys =  this.topology.topology.map((guardian) => guardian.btcKey);
        HexKeys.push(this.fillerKey(index+1));
        const pubkeys = HexKeys.map(key => Buffer.from(key, 'hex'));
        const p2shAddress = bitcoin.payments.p2wsh({
            redeem: bitcoin.payments.p2ms({ m: this.topology.m , pubkeys ,
            network: bitcoin.networks[this.config.network], }),
            network: bitcoin.networks[this.config.network],
        });
        return p2shAddress.redeem.output.toString('hex');
    }
    

    getPaymentPaths(){
        return this.config.paymentPaths;
    }



    fillerKey(index: number){
        const indexHex = "0300000000000000000000000000000000000000000000000000000000" + index.toString(16).padStart(8, '0');
        return indexHex;
    }
}



