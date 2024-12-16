import exp from 'constants'
//import * as Lucid  from 'lucid-cardano'
import * as LucidEvolution from '@lucid-evolution/lucid'
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
    "network": string
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
    type: "mint" | "burn" | "rejection" | "confescation",
    status: "pending" | "completed" ,
    txId: string,
    signatures: string[],
    tx: LucidEvolution.TxSignBuilder,
    metadata? : any,
    redemptionTx?: string
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
    redemptionMargin: number
    btcNetworkFeeMultiplyer: number
    fixedFee: number
    margin: number
    utxoCharge: number
    maxConsolidationTime: number
    consolidationThreshold : number
    minMint: number
    minRedemption: number
    maxBtcFeeRate : number 
    mintDeposit: number
    mintTimeoutMinutes: number  
    adminAddress: string
    finality: {
      cardano: number
      bitcoin: number
    }
    contract: string
    adminToken: string
    paymentPaths : number
}

export type cardanoConfig = {
    DbName : string,
    network: string
    mongo: {
      connectionString: string
    }
    utxoRpc: {
      host: string
      headers: Record<string, string>
    }
    startPoint?: {
      slot: number
      hash: string
    }
    }

export type notificationConfig = {
    directory: string 
}


export type secretsConfig ={
    "seed" : string
}

export const MintRequestSchema = LucidEvolution.Data.Object({
  amount: LucidEvolution.Data.Integer(),
  path: LucidEvolution.Data.Integer(),
});

export const RedemptionRequestSchema = LucidEvolution.Data.Object({
  destinationAddress: LucidEvolution.Data.Bytes()
});

export interface mintRequest extends LucidEvolution.UTxO{
  decodedDatum:  typeof MintRequestSchema
  
}

export interface redemptionRequest extends LucidEvolution.UTxO{
  decodedDatum:  typeof RedemptionRequestSchema
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
  index: number,
  alternative: number,
  currentTransaction: string,
  burningTransaction: {
    tx: string, 
    txId: string , 
    signatures: string[]
  },
  redemptionSignatures?: string,
  redemptionTxId?: string,
  redemptionTx?: string
}


export enum redemptionState{
  found,
  forged,
  burned,
  completed,
  finalized,
  cancelled
}

