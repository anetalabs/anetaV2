import exp from 'constants'
import * as Lucid  from 'lucid-cardano'
import * as bitcoin from 'bitcoinjs-lib'
import { BatchType } from 'mongodb'

export  type bitcoinConfig =
{
    "bitcoinRPC" :{
        "username": string,
        "password": string,
        "port": number,
        "host": string,
        "timeout": number
    },
    "falbackFeeRate" : number,
    "BTCadminAddress": string,
    "BTCPrivKey": string,
    "Finality" : number,
    "network": string,
    "paymentPaths" : number
}

export type topology = {

    
        "topology" : [
            {
              "name": string ,
              "ip": string,
              "port": number,
              "AdaPkHash": string,
              "btcKey": string
              },
        ],    
        "m": number
}

export type pendingBitcoinTransaction = {
    type: "consolidation" | "redemption" | "withdrawal"
    status: "pending" | "completed" ,
    tx: bitcoin.Psbt,
}

export type pendingCardanoTransaction = {
    type: "mint" | "burn" | "rejection",
    status: "pending" | "completed" ,
    txHash: string,
    index: number,
    signatures: string[],
    tx: Lucid.TxComplete,
    metadata? : any
}

export enum NodeStatus {
  Learner = 'learner',
  Follower = 'follower',
  Candidate = 'candidate',
  Monitor = 'monitor',
  Leader = 'leader',
  Disconnected = 'disconnected'
}

export type protocolConfig = {
    fixedFee: number,
    margin: number,
    utxoCharge: number
    maxConsolidationTime: number
    consolidationThreshold : number
    minMint: number
    minRedemption: number
}

export type cardanoConfig = {
    DbName : string,
    network: string
    paymentAddress: string
    mongo: {
      connectionString: string
    }
    lucid: {
      provider: {
        type: string
        host: string
      }
    }
    utxoRpc: {
      host: string
      key: string
    }
    contract: string,
    finality: number
  }

export type notificationConfig = {
    directory: string 
}


export type secretsConfig ={
    "seed" : string
}

export const MintRequestSchema = Lucid.Data.Object({
  amount: Lucid.Data.Integer(),
  path: Lucid.Data.Integer(),
});

export const RedemptionRequestSchema = Lucid.Data.Object({
  destinationAddress: Lucid.Data.Bytes()
});

export interface mintRequest extends Lucid.UTxO{ 
  decodedDatum:  typeof MintRequestSchema
}

export interface redemptionRequest extends Lucid.UTxO{
  decodedDatum: typeof RedemptionRequestSchema
}


export type utxo = {
  txid: string,
  vout: number,
  scriptPubKey: string,
  amount: number,
  height: number
}

export interface redemptionController{
  state : redemptionState,
  currentTransaction?: bitcoin.Psbt,
  requestsFilling?: redemptionRequest[],
  burningTransaction?: string,
  redemptionTx?: string
}


enum redemptionState{
  open,
  forged,
  burned,
  completed,
}

