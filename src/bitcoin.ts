import BitcoinCore from "bitcoin-core"
import * as bitcoin from 'bitcoinjs-lib';
import {ECPairFactory}  from 'ecpair'
import * as ecc  from 'tiny-secp256k1'
import { EventEmitter } from 'events';
import {bitcoinConfig, topology, secretsConfig,  redemptionRequest, protocolConfig ,redemptionController} from "./types.js"
import * as bip39 from 'bip39';
import {BIP32Factory , BIP32Interface} from 'bip32';
import { utxo } from "./types.js";
import  {METADATA_TAG} from "./cardano.js";
import { ADAWatcher, communicator, coordinator } from "./index.js";


const ECPair =  ECPairFactory(ecc);
export const utxoEventEmitter = new EventEmitter();

type addressUtxos = {
    index: number,
    address: string,
    utxos: utxo[]
}


export class BitcoinWatcher{
    private client: BitcoinCore;
    private address: string[];
    private utxos: addressUtxos[];
    private isSynced: boolean = false;
    private watcherKey: any; 
    private config: bitcoinConfig ;
    private topology: topology;
    private gettingUtxos: boolean = false;
    private root: BIP32Interface ;
    private consolidationQue: number[] = []; 
    private protocol: protocolConfig;

    constructor(config : bitcoinConfig, topology : topology, secrets : secretsConfig, protocol : protocolConfig){
        console.log("bitcoin watcher")
        this.config = config
        this.topology = topology
        this.protocol = protocol
        this.client = new BitcoinCore(config.bitcoinRPC);
        this.address =  Array.from({length: protocol.paymentPaths}, (_, index) => index).map((index) => this.getAddress(index))
        console.log("Vault Address:", this.getVaultAddress())
        this.watcherSync()
        const seed = bip39.mnemonicToSeedSync(secrets.seed);
        const bip32 = BIP32Factory(ecc);
        this.root = bip32.fromSeed(seed);
        const path = "m/44'/0'/0'/0/0"; // This is the BIP44 path for the first address in the first account of a Bitcoin wallet
        const node = this.root.derivePath(path);

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
                coordinator.onNewBtcBlock();                
            }
        }, 5000); // Check every 5 seconds
    }

    getHeight = async () => {
        const height = await this.client.getBlockCount()
        console.log("BTC height: ", height)
        return height
    }

    satToBtc = (sat: number) => {
        return sat / 100_000_000;
    }

    btcToSat = (btc: number) => {
        return btc * 100_000_000;
    }

    watcherSync = async () => {
        let isSynced = await this.isNodeSynced();
        while (!isSynced) {
            console.log('Bitcoin Node is not synced');
            await new Promise((resolve) => setTimeout(resolve, 5000));
            isSynced = await this.isNodeSynced();
        }
        
        await this.getUtxos();
        console.log("BTC Node is synced")
        console.log("this.utxos", this.utxos)
        this.isSynced = true;
        coordinator.onNewBtcBlock();
        this.startListener()
    };

    getMyPublicKey = () => {
        const path = "m/44'/0'/0'"; 
        const node = this.root.derivePath(path);
        const BtcPublicKey = node.neutered().toBase58()
        return BtcPublicKey
    }

    getLoadedUtxos = () => {    
        return this.utxos;
    }

    getVaultUtxos = () => {
        return this.utxos[this.address.length].utxos;
    }

    getUtxosByIndex = (index: number) => {
        try{
            return this.utxos[index].utxos;
        } catch (e) {   
            return [];
        }
    }

    inSync =  () => {
        return this.isSynced;
    }

    isNodeSynced = async () => {
        const info = await this.client.command('getblockchaininfo');
        const isSynced = info.headers === info.blocks;
        return isSynced;
    }
    
    psbtFromHex = (hex: string) => {
        return bitcoin.Psbt.fromHex(hex, {network : bitcoin.networks[this.config.network] });
    }

    combine(psbt1: bitcoin.Psbt, psbt2: string) {
        const txb1 = psbt1
        const txb2 = bitcoin.Psbt.fromHex(psbt2, {network : bitcoin.networks[this.config.network] });
        const txb = txb1.combine(txb2);
        return txb;
    }

    completeAndSubmit(txb: bitcoin.Psbt) {
        
        const tx = txb.extractTransaction();
        const txHex = tx.toHex();
        console.log(txHex);
        return this.client.sendRawTransaction(txHex);
    }

    // withdrawProfits = async (amount: number) => {
    //    try{ 
    //     const txb = new bitcoin.Psbt({network : bitcoin.networks[this.config.network] });
    //     let total = 0;
    //     let txSize = 10 + 34 * 2; // Replace numOutputs with the number of outputs
    //     const nonWitnessData = 41;
    //     const witnessData = this.topology.m * 73 + this.topology.topology.length * 34 + 3 + this.topology.m + this.topology.topology.length * 34 + 1;
    //     const inputSize = nonWitnessData + Math.ceil(witnessData / 4);
    //     const utxos = this.utxos[0].utxos;
    //     const redeemScript = Buffer.from(this.getRedeemScript(0), 'hex');
    //     for (let i = 0; i < utxos.length; i++) {
    //         total += Math.round(utxos[i].amount * 100000000) ;
    //         txb.addInput({
    //             hash: utxos[i].txid,
    //             index: utxos[i].vout,
    //             witnessUtxo: {
    //                 script: Buffer.from(utxos[i].scriptPubKey, 'hex'),
    //                 value: Math.round(utxos[i].amount * 100_000_000),
    //             },
    //             witnessScript: redeemScript,
    //         });
    //     }

    //     txSize += utxos.length * inputSize;
    //     console.log(txSize)
    //     if (total === 0) throw new Error('No UTXOs to redeem');
    //     const feerate = await this.getFee() ;
    //     const fee = Math.round( 100_000 * feerate  * txSize) ; //round to 8 decimal places
    //     const amountToSend = total - fee;
    //     if (amountToSend < amount) throw new Error('Not enough funds');
    //     txb.addOutput({address: this.address[0], value: total  - amount });
    //     txb.addOutput({address: this.config.BTCadminAddress, value: amount - fee });
    //     txb.signAllInputs(this.watcherKey);
    //     txb.finalizeAllInputs();
    //     const tx = txb.extractTransaction();
    //     const txHex = tx.toHex();
    //     const resault = await this.client.sendRawTransaction(txHex);
    //     console.log(resault);
    // } catch (e) {
    //     console.log(e)
    // }
        
    // }

    craftRedemptionTransaction = async (requests: redemptionRequest[]) : Promise<[bitcoin.Psbt , redemptionRequest[] ]> => {
        while ( this.isSynced === false) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
        try{
            const txb = new bitcoin.Psbt({network : bitcoin.networks[this.config.network] });
            let total = 0;
            let txSize = 10 + 34 * (requests.length+1)
            const nonWitnessData = 41;
            const witnessData = this.topology.m * 73 + this.topology.topology.length * 34 + 3 + this.topology.m + this.topology.topology.length * 34 + 1;
            const inputSize = nonWitnessData + Math.ceil(witnessData / 4);
            const utxos = this.utxos[this.utxos.length - 1 ].utxos;
            console.log("crafting redemption transaction");
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
            const fee = Math.round( 100_000 * feerate  * txSize * coordinator.getConfig().btcNetworkFeeMultiplyer)  ; //round to 8 decimal places
            let amountToSend = 0
            
            requests.forEach((request) => {
                const amount =  coordinator.calculateRedemptionAmount(request);
                txb.addOutput({address: request.decodedDatum , value: amount });
                amountToSend += amount;
            });

            const change = Math.round( total - amountToSend - fee);
            if (change < 0){
                //remove the largest request and try again
                const trimedRequests = requests.sort((a, b) => coordinator.calculateRedemptionAmount(b) - coordinator.calculateRedemptionAmount(a)).slice(1);
                if (trimedRequests.length === 0) throw new Error('Not enough funds');
                return this.craftRedemptionTransaction( trimedRequests)
            }
            txb.addOutput({address: this.getVaultAddress(), value: change });
            
            
            
            // if (amountToSend < requests.reduce((acc, request) => acc + Number(request.assets[ADAWatcher.getCBtcId()]), 0)) throw new Error('Not enough funds');
        
            return [txb, requests];
        } catch (e) {
            console.log(e)
        }

    }

    async checkFinalizedRedemptionTx (redemption : redemptionController): Promise <boolean> {
        try{
            console.log("checking redemption transaction")

            const txc = ADAWatcher.txCompleteFromString(redemption.burningTransaction.tx);
            const [txDetails, cTx] = ADAWatcher.decodeTransaction(redemption.burningTransaction.tx);
            const medatadata = cTx.auxiliary_data().metadata().get(BigInt(METADATA_TAG)).to_json_value();
            const txString = medatadata.list.map((substring) =>  substring.string ).join("") 
            if(txString !== redemption.currentTransaction) throw new Error('Invalid burn transaction hash');
        

            if(this.txEqual(redemption.currentTransaction, redemption.redemptionTx) === false) throw new Error('Invalid redemption transaction');
            if(this.txEqual(redemption.burningTransaction.tx, redemption.currentTransaction) === false) throw new Error('Invalid burn transaction');
            const txb = bitcoin.Psbt.fromHex(redemption.currentTransaction, {network : bitcoin.networks[this.config.network] });

            if(txb.extractTransaction().getId() !== redemption.redemptionTxId) throw new Error('Invalid redemption transaction hash');
            // I want to check that the burn is confirmed, that the metadata is correct 
            if(txc.toHash() !== redemption.burningTransaction.txId) throw new Error('Invalid burn transaction hash');
            
            const burnConfirmed = await ADAWatcher.isBurnConfirmed(redemption.burningTransaction.txId);
            if(!burnConfirmed) throw new Error('Burn transaction not confirmed');


            if(txDetails.outputs.length !== 1 || txDetails.outputs[0].address !== coordinator.config.adminAddress || txDetails.outputs[0].amount.multiasset !== null ) 
                throw new Error('Invalid burn transaction Output');
        
        
            return true;
        } catch (e) {
            console.log(e)
            return false;
        }
        
    
    }
        

    checkRedemptionTx(tx : string, burnTx : string) : boolean{
        console.log("checking redemption transaction")
        const txb = bitcoin.Psbt.fromHex(tx, {network : bitcoin.networks[this.config.network] });
        const txc = ADAWatcher.txCompleteFromString(burnTx);
        const [txDetails, cTx] = ADAWatcher.decodeTransaction(burnTx);
        console.log(cTx.auxiliary_data().metadata().get(BigInt(METADATA_TAG)).to_json_value(), cTx.auxiliary_data().metadata().get(BigInt(METADATA_TAG)).to_json() , cTx.auxiliary_data().metadata().get(BigInt(METADATA_TAG)))
        const medatadata = JSON.parse(cTx.auxiliary_data().metadata().get(BigInt(METADATA_TAG)).to_json());
        console.log(medatadata)
        const txString = medatadata.list.map((substring) =>  substring.string ).join("")
        let redemptionRequests =  ADAWatcher.getRedemptionRequests();
           // check than no 2 requests are the same by txHash and outputIndex
        const requestMap = new Map<string, redemptionRequest>();
        let totalInputValue = 0;
        let totalOutputValue = 0;
        if(txString !== tx) throw new Error('Invalid burn transaction hash');

        
        redemptionRequests = redemptionRequests.filter((request) => txDetails.inputs.find((input) => input.transaction_id === request.txHash && Number(input.index) === request.outputIndex) !== undefined);
        
        const burenedRequests = txDetails.inputs.map((input) => {
            return input.transaction_id + input.index;
        });
        console.log(txDetails.outputs[0])
        console.log(txDetails.outputs[0], txDetails.outputs)
        if(txDetails.outputs.length !== 1 || txDetails.outputs[0].AlonzoFormatTxOut.address !== coordinator.config.adminAddress || Object.keys(txDetails.outputs[0].AlonzoFormatTxOut.amount.multiasset).length !== 0 ) 
            throw new Error('Invalid burn transaction Output');
        
        
        let totalBurn = 0;
        redemptionRequests.forEach((request) => {
            if(burenedRequests.includes(request.txHash + request.outputIndex)){
                const key = request.txHash + request.outputIndex;
                totalBurn += Number(request.assets[ADAWatcher.getCBtcId()]);
                if(requestMap.has(key)) throw new Error('Duplicate Redemption Request');
                cTx.body().inputs()
                requestMap.set(key, request);
            }
        });

        if(txDetails.inputs.length !== requestMap.size) 
            throw new Error('Invalid burn transaction Input');
        

        console.log(Object.keys(txDetails.mint).length,Object.keys(txDetails.mint[ADAWatcher.getCBtcPolicy()]).length,txDetails.mint[ADAWatcher.getCBtcPolicy()][ADAWatcher.getCBtcHex()], -totalBurn )
        
        if(Object.keys(txDetails.mint).length !== 1 || Object.keys(txDetails.mint[ADAWatcher.getCBtcPolicy()]).length !== 1 || Number(txDetails.mint[ADAWatcher.getCBtcPolicy()][ADAWatcher.getCBtcHex()]) !== -totalBurn)
                throw new Error('Invalid burn transaction mint');
            
            console.log("redemptionRequests", redemptionRequests)
            const ValidRedemptionScript = this.getVaultRedeemScript()
            txb.data.inputs.forEach((input) => {
                if(input.witnessScript.toString('hex') !== ValidRedemptionScript) throw new Error('Invalid redemption transaction Input');
        });

        
        txb.txOutputs.forEach((output) => {
            if(output.address !== this.getVaultAddress())
            {                   
                const request = [...requestMap.values()].find((request) => (request.decodedDatum === output.address) && ( coordinator.calculateRedemptionAmount(request) === output.value));
                if(request === undefined) throw new Error('Invalid redemption transaction Output(not found)');    
                
                if( output.value !== coordinator.calculateRedemptionAmount(request)) throw new Error('Invalid redemption transaction Output(wrong amount) ');
                if(requestMap.has(request.txHash + String(request.outputIndex))){
                     requestMap.delete(request.txHash + String(request.outputIndex))
                }else{
                    throw new Error('Duplicate Redemption fulfillment');
                }
            }
        });
        if( requestMap.size !== 0) throw new Error('Not all redemption requests were fulfilled');

        return true;
    }

    checkTransaction(tx: bitcoin.Psbt){
        const txb = tx;
        // I want the utxos from all the addresses

        const utxos =  this.utxos.map((addressUtxos) => addressUtxos.utxos).flat();

        txb.txInputs.forEach((input) => {
            const utxo = utxos.find((utxo) => utxo.txid === Buffer.from(input.hash).toString("hex") && utxo.vout === input.index);
            if (utxo === undefined) return false
        });
        return true;

    }

    completeRedemption = async (txHex: string) => {
        const txb = bitcoin.Psbt.fromHex(txHex, {network : bitcoin.networks[this.config.network] });
        
        txb.signAllInputs(this.watcherKey); 
        communicator.sendToLeader("redemptionSignature", txb.toHex());

    }

    getTxId = (txHex: string) => {
        const txb2 = bitcoin.Psbt.fromHex(txHex, {network : bitcoin.networks[this.config.network] });
        txb2.finalizeAllInputs();
        const tx = txb2.extractTransaction();
        return tx.getId();
    }


    txEqual = (tx1: string, tx2: string) => {
        const txb1 = bitcoin.Psbt.fromHex(tx1, {network : bitcoin.networks[this.config.network] });
        const txb2 = bitcoin.Psbt.fromHex(tx2, {network : bitcoin.networks[this.config.network] });
        const sortedInputs1 = txb1.txInputs.sort((a, b) => a.hash.toString('hex').localeCompare(b.hash.toString('hex')) || a.index - b.index);
        const sortedInputs2 = txb2.txInputs.sort((a, b) => a.hash.toString('hex').localeCompare(b.hash.toString('hex')) || a.index - b.index);

        for(let i = 0; i < sortedInputs1.length; i++){
            if(sortedInputs1[i].hash.toString('hex') !== sortedInputs2[i].hash.toString('hex') || sortedInputs1[i].index !== sortedInputs2[i].index) throw new Error('Invalid Tx Inputs');
        }

        const sortedOutputs1 = txb1.txOutputs.sort((a, b) => a.address.localeCompare(b.address) || a.value - b.value);
        const sortedOutputs2 = txb2.txOutputs.sort((a, b) => a.address.localeCompare(b.address) || a.value - b.value);
      
        for(let i = 0; i < sortedOutputs1.length; i++){
          if(sortedOutputs1[i].address !== sortedOutputs2[i].address || sortedOutputs1[i].value !== sortedOutputs2[i].value) throw new Error('Invalid Tx Outputs');
        }
      
        return true;

    }

    isTxConfirmed = async (txid: string) => {
        try{

           return  this.getVaultUtxos().some((utxo) => utxo.txid === txid);
        } catch (e) {
            if(e.code === -18) {
                await this.client.command('createwallet', 'mywallet');
            }
            console.log("Failed confirming Tx", e)
            return false;
        }

        }

    

    updatePendingFees = async () => {   
        
        try{
            console.log("Updating pending fees")
            // I want to get any tx that is in the mempool , consumes a utxo from one of my addresses and has a fee that is lower than the current fee rate
            const txHash = "b610d22a81af27a590fb5bbfa159fe24ae6360130c4438b6a0af2e43b0587d45"
            const txs =await this.client.getRawTransaction("b610d22a81af27a590fb5bbfa159fe24ae6360130c4438b6a0af2e43b0587d45", true)
            console.log(txs.hex)
            const oldTx = bitcoin.Transaction.fromHex(txs.hex);
            const txb = new bitcoin.Psbt({network : bitcoin.networks[this.config.network] });
            const addressUtxos = this.utxos[this.utxos.length -1].utxos;
            let total = 0;
            const redeemScript =  Buffer.from(this.getVaultRedeemScript(), 'hex');
            
            total += Math.round(oldTx.outs[oldTx.outs.length -1].value) ;
            txb.addInput({
                hash: txHash,
                index: oldTx.outs.length -1,
                witnessUtxo: {
                    script: oldTx.outs[oldTx.outs.length -1].script,
                    value: Math.round(oldTx.outs[oldTx.outs.length -1].value),
                },
                witnessScript: redeemScript,
             });
             

            let outputTotal = 0;
            
            const feerate =   await this.getFee() ;
            
            const fee = Math.round( 100_000 * feerate  * txs.size)* 20 ; //round to 8 decimal places
            
            // Calculate the fee /////////////////////////////////////////////
            const oldFee = this.btcToSat(0.00000397)  // TODO : get the fee from the tx

            const amount = total - fee;
            txb.addOutput({address: this.getVaultAddress(), value: amount });

            console.log("old fee", oldFee, "new fee", fee, "outputTotal", amount, "total", total)
        
            
            txb.txOutputs.forEach((output) => console.log("new output", output.value))
            console.log("new Tx Inputs:",txb.txInputs)
            txb.signAllInputs(this.watcherKey);
            txb.finalizeAllInputs();
            const tx = txb.extractTransaction();
            const txHex = tx.toHex();
            const resault = await this.client.sendRawTransaction(txHex);
            console.log("fee update completed", resault);

      
        } catch (e) {
            console.log(e)
        }
    }

    async signRedemptionTransaction(txHex: string) {
        const txb = bitcoin.Psbt.fromHex(txHex, {network : bitcoin.networks[this.config.network] });
        const TxHash = txHex
      //  console.log("signing redemption transaction" , txHex, hash)
        // check if the transaction is a redemption transaction and if it is in the utxos 
        if(! ADAWatcher.confirmRedemption(TxHash))
            throw new Error('Invalid redemption transaction');

        let totalInputValue = 0;
        let totalOutputValue = 0;

        txb.data.inputs.forEach((input) => {
           
        });

        txb.txOutputs.forEach((output) => {
            totalOutputValue += output.value;
        });


        txb.signAllInputs(this.watcherKey);
        return txb.toHex();
    
    }

    signConsolidationTransaction(txHex : string) {
        console.log("signing consolidation transaction" , txHex)
        const txb = bitcoin.Psbt.fromHex(txHex, {network : bitcoin.networks[this.config.network] });
        const validScipts = this.consolidationQue.map((index) => this.getRedeemScript(index));
        // check if the transaction is a consolidation transaction and if it is in the consolidation que 
        let totalInputValue = 0;
        let totalOutputValue = 0;
        txb.data.inputs.forEach((input) => {

            if(validScipts.includes(input.witnessScript.toString('hex')) === false) throw new Error('Invalid consolidation transaction Input');

            totalInputValue += input.witnessUtxo.value;
            
        });


        txb.txOutputs.forEach((output) => {
            totalOutputValue += output.value;
            if (output.address !== this.getVaultAddress()) throw new Error('Invalid consolidation transaction Output');
        });

    
        txb.data.inputs.forEach((input, index) => 
            txb.signInput(index, this.watcherKey)
        );
       // txb.signAllInputs(this.watcherKey);

        return txb.toHex();
    }

    async createConsolidationTransaction(indexs: number[]) : Promise< bitcoin.Psbt>{
        try{

            const txb = new bitcoin.Psbt({network : bitcoin.networks[this.config.network] });
            let total = 0;
            let txSize = 10 + 35;
            const nonWitnessData = 41;
            const witnessData = this.topology.m * 73 + this.topology.topology.length * 34 + 3 + this.topology.m + this.topology.topology.length * 34 + 1;
            const inputSize = nonWitnessData + Math.ceil(witnessData / 4);   
            console.log("consolidating payments", indexs);

            const keys = [];

            indexs.map((index) => {
                if (index >= this.utxos.length - 1 ) throw new Error('Index out of range');

                const addressUtxos = this.utxos[index].utxos;
                const redeemScript = Buffer.from(this.getRedeemScript(index), 'hex');
                
            for (let i = 0; i < addressUtxos.length; i++) {
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
                const path = "m/44'/0'/0'/0"; // This is the BIP44 path for the first address in the first account of a Bitcoin wallet
                const node = this.root.derivePath(path);
                
                keys.push ( ECPair.fromPrivateKey(Buffer.from(node.derive(index+1).privateKey.toString('hex'),'hex'), { network: bitcoin.networks[this.config.network] }))
            }

            txSize += addressUtxos.length * inputSize;
            });
            
            if (total === 0) throw new Error('No UTXOs to redeem');
            const feerate =   await this.getFee() ;
        
            const fee = Math.round( 100_000 * feerate  * txSize * coordinator.getConfig().btcNetworkFeeMultiplyer) ; //round to 8 decimal places 
            const amount = total - fee;
            console.log("total", total, "fee", fee, "amount", amount, "txSize", txSize, "feerate", feerate);  
            console.log({address: this.getVaultAddress(), value: amount });
            txb.addOutput({address: this.getVaultAddress(), value: amount });
            
            for(let i = 0; i < txb.inputCount; i++){
                txb.signInput(i, keys[i]);
            }

           const txHex = txb.toHex();



            // const signatures = txb.data.inputs.map((input) => input.partialSig[0].signature.toString('hex'));
            return txb;

    } catch (e) {   
        console.log(e)
    }
}

    consolidatePayments = async (indexs: number[]) => {
        console.log("consolidating payments", indexs);
        if(communicator.amILeader()){ 
                const tx  = await this.createConsolidationTransaction(indexs);
                communicator.bitcoinTxToComplete({type: "consolidation", status:"pending" , tx: tx });
        }else{
            indexs.map(index => { 
                if(!this.consolidationQue.includes(index)){
                    this.consolidationQue.push(index);
                }
        });
        }
    }

    getM = () => {
        return this.topology.m;
    }
    

    refundIndex = (index: number) => {

    }
    
    getFee = async () => {  
        const fee = await this.client.estimateSmartFee(100, "ECONOMICAL")
        if(fee.feerate && fee.feerate > coordinator.config.maxBtcFeeRate) throw new Error(`Fee rate over limit ${fee.feerate} > ${coordinator.config.maxBtcFeeRate}`);
        return fee.feerate ? fee.feerate : this.config.falbackFeeRate;
    }

    getUtxos = async () => {
        try{

            
            if (this.gettingUtxos) return;
            this.gettingUtxos = true;
            const descriptors = this.address.map(address => ({ 'desc': `addr(${address})`, 'range': 1000 }));
            descriptors.push({ 'desc': `addr(${this.getVaultAddress()})`, 'range': 1000 });
            const height = await this.getHeight()
            await this.client.command('scantxoutset', 'abort', descriptors)
            const resault =  await this.client.command('scantxoutset', 'start', descriptors)
            const utxosRaw =  resault.unspents.map((utxo) => Object.assign( {}, utxo)).filter((utxo) => utxo.height <= height - coordinator.config.finality.bitcoin);
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
        console.log("Vault", this.utxos[this.address.length])
        this.gettingUtxos = false;
    } catch (e) {
        console.log(e)
        this.gettingUtxos = false;
    }
    }

    isAddressValid(Address : string){
        try{
            bitcoin.address.toOutputScript(Address, bitcoin.networks[this.config.network]);
            return true;
        } catch (e) {
            return false;
        }

    }

    getVaultAddress(){
        const HexKeys =  this.topology.topology.map((guardian , guardianIndex) => {
            const bip32 = BIP32Factory(ecc);
            const parent = bip32.fromBase58(guardian.btcKey);
            const child = parent.derive(0);
            return child.derive(0).publicKey.toString('hex'); 
        });
        const pubkeys = HexKeys.map(key => Buffer.from(key, 'hex'));
        const p2shAddress = bitcoin.payments.p2wsh({
            redeem: bitcoin.payments.p2ms({ m: this.topology.m , pubkeys ,
            network: bitcoin.networks[this.config.network], }),
            network: bitcoin.networks[this.config.network],
        });
    
        return p2shAddress.address; 
    }
    
    getAddress(index: number){
        if(index < 0 || index >= this.protocol.paymentPaths) throw new Error('Index out of range');
        const HexKeys =  this.topology.topology.map((guardian , guardianIndex) => {
            const bip32 = BIP32Factory(ecc);
            const parent = bip32.fromBase58(guardian.btcKey);
            const child = parent.derive(0);
            return guardianIndex === 0 ? child.derive(index+1).publicKey.toString('hex') : child.derive(0).publicKey.toString('hex'); 
        });

        const pubkeys = HexKeys.map(key => Buffer.from(key, 'hex'));

        const p2shAddress = bitcoin.payments.p2wsh({
            redeem: bitcoin.payments.p2ms({ m: this.topology.m , pubkeys ,
            network: bitcoin.networks[this.config.network], }),
            network: bitcoin.networks[this.config.network],
        });
    
        return p2shAddress.address; 
    }
    
    getVaultRedeemScript(){
        const HexKeys =  this.topology.topology.map((guardian) => {
            const bip32 = BIP32Factory(ecc);
            const parent = bip32.fromBase58(guardian.btcKey);
            const child = parent.derive(0);
            return child.derive(0).publicKey.toString('hex'); 
        });

        const pubkeys = HexKeys.map(key => Buffer.from(key, 'hex'));
        const p2shAddress = bitcoin.payments.p2wsh({
            redeem: bitcoin.payments.p2ms({ m: this.topology.m , pubkeys ,
            network: bitcoin.networks[this.config.network], }),
            network: bitcoin.networks[this.config.network],
        });
        return p2shAddress.redeem.output.toString('hex');
    }

    getRedeemScript(index: number){
        const HexKeys =  this.topology.topology.map((guardian , guardianIndex) => {
            const bip32 = BIP32Factory(ecc);
            const parent = bip32.fromBase58(guardian.btcKey);
            const child = parent.derive(0);
            return guardianIndex === 0 ? child.derive(index+1).publicKey.toString('hex') : child.derive(0).publicKey.toString('hex'); 
        });
        const pubkeys = HexKeys.map(key => Buffer.from(key, 'hex'));
        const p2shAddress = bitcoin.payments.p2wsh({
            redeem: bitcoin.payments.p2ms({ m: this.topology.m , pubkeys ,
            network: bitcoin.networks[this.config.network], }),
            network: bitcoin.networks[this.config.network],
        });
        return p2shAddress.redeem.output.toString('hex');
    }
    

    getPaymentPaths(){
        return this.protocol.paymentPaths;
    }


}



