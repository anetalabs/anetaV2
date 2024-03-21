import { cardanoWatcher } from "./cardano.js"
import { bitcoinWatcher } from "./bitcoin.js";
import EventEmitter from "events";

export const emitter = new EventEmitter();

export class coordinator{
    cardanoWatcher: cardanoWatcher
    bitcoinWatcher: bitcoinWatcher

    constructor(cardanoWatcher : cardanoWatcher, bitcoinWatcher : bitcoinWatcher){
        this.cardanoWatcher = cardanoWatcher;
        this.bitcoinWatcher = bitcoinWatcher;

        emitter.on("newCardanoBlock", this.onNewCardanoBlock);
        emitter.on("newBtcBlock", this.onNewBtcBlock.bind(this));

    }

    async getOpenRequests(){
        console.log(this.cardanoWatcher  )
        let openRequests = await this.cardanoWatcher.getOpenRequests();
        return openRequests;
    }

    async onNewCardanoBlock(){
      //  console.log("New Cardano Block event");

    
    }

    async onNewBtcBlock(){
       // let btcUtxos = await this.bitcoinWatcher.getUtxos();
        let openRequests = await this.cardanoWatcher.getOpenRequests();
        openRequests.map((request) => {
            console.log( this.cardanoWatcher.decodeDatum(request.datum));
        })
        
        console.log( openRequests);
    }
}