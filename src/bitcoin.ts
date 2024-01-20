import BitcoinCore from "bitcoin-core"
import ECPairFactory  from 'ecpair'
import ecc  from 'tiny-secp256k1'
import * as config from '../config.json';


export class bitcoinWatcher{
    client: BitcoinCore;

    constructor(){
        this.client = new BitcoinCore(config.bitcoinRPC);
        console.log('Bitcoin Watcher')
        this.startListener()

    }

    startListener = async () => {
        let lastHeight = await this.getHeight();
        console.log(lastHeight);

        setInterval(async () => {
            const currentHeight = await this.getHeight();
            if (currentHeight !== lastHeight) {
                console.log("new BTC block: ",currentHeight);
                await this.getUtxos()
                
                lastHeight = currentHeight;
            }
        }, 5000); // Check every 5 seconds
    }

    getHeight = async () => {
        const height = await this.client.getBlockCount()
        return height
    }

    getUtxos = async () => {
        const utxos = await this.client.listUnspent(0, 9999999, [])
        return utxos
    }

    
}
