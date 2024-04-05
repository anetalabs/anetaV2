import * as Lucid  from 'lucid-cardano'

export type nodeStatus = {  
    "status" : "leader" | "follower" | "candidate" | "monitor" | "learner"
} 


export  type bitcoinConfig =
{
    "bitcoinRPC" :{
        "username": string,
        "password": string,
        "port": number,
        "host": string,
        "timeout": number
    },
    "BTCadminAddress": string,
    "BTCPrivKey": string,
    "Finality" : number,
    "network": string,
    "paymentPaths" : number
}

export type topology = {

    
        "topology" : [
            {"name": string ,
              "ip": string,
              "port": number,
              "AdaPkHash": string,
              "btcKey": string
              },
        ],    
        "m": number
}

export type cardanoConfig = {
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
    contract: string
  }

export type notificationConfig = {
    directory: string 
}


export type secretsConfig ={
    "seed" : string
}

export const MintRequesrSchema = Lucid.Data.Object({
  amount: Lucid.Data.Integer(),
  path: Lucid.Data.Integer(),
});

export interface decodedRequest extends Lucid.UTxO{ 
  decodedDatum: typeof MintRequesrSchema
}


export type utxo = {
  txid: string,
  vout: number,
  scriptPubKey: string,
  amount: number,
  height: number
}