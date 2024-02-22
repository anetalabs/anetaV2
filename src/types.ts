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

