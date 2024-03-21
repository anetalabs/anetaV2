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
    mintingScript: {
      keyHash: string
      type: string
    }
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
  }

export type notificationConfig = {
    directory: string 
}


export type secretsConfig ={
    "seed" : string
}

