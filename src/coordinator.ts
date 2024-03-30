import { cardanoWatcher } from "./cardano.js"
import { bitcoinWatcher } from "./bitcoin.js";
import EventEmitter from "events";

export const emitter = new EventEmitter();

interface mintRequest{
    amount: number
    txHash: string
    index: number
    path: number
}

export class coordinator{
    cardanoWatcher: cardanoWatcher
    bitcoinWatcher: bitcoinWatcher
    mintRequests: mintRequest[]

    constructor(cardanoWatcher : cardanoWatcher, bitcoinWatcher : bitcoinWatcher){
        this.cardanoWatcher = cardanoWatcher;
        this.bitcoinWatcher = bitcoinWatcher;
        this.getOpenRequests = this.getOpenRequests.bind(this);
        this.onNewCardanoBlock = this.onNewCardanoBlock.bind(this);

        emitter.on("newCardanoBlock", this.onNewCardanoBlock);
        emitter.on("newBtcBlock", this.onNewBtcBlock.bind(this));

    }

    async getOpenRequests(){
        let openRequests = await this.cardanoWatcher.getOpenRequests();
        openRequests.map( (request) => {
           // const id = request.hash + request.index;
            
        });
        return openRequests;
    }

    async onNewCardanoBlock(){
      //  console.log("New Cardano Block event");
    
    }

    async onNewBtcBlock(){
       // let btcUtxos = await this.bitcoinWatcher.getUtxos();
        
    }
}