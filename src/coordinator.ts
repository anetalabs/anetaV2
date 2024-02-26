import { cardanoWatcher } from "./cardano.js"
import { bitcoinWatcher } from "./bitcoin.js";
import EventEmitter from "events";

export const emmiter = new EventEmitter();

export class coordinator{
    cardanoWatcher: cardanoWatcher
    bitcoinWatcher: bitcoinWatcher

    constructor(cardanoWatcher : cardanoWatcher, bitcoinWatcher : bitcoinWatcher){
        this.cardanoWatcher = cardanoWatcher;
        this.bitcoinWatcher = bitcoinWatcher;

        emmiter.on("newCardanoBlock", this.onNewCardanoBlock);
        emmiter.on("newBtcBlock", this.onNewBtcBlock.bind(this));
    }

    async getOpenRequests(){
        let openRequests = await this.cardanoWatcher.getOpenRequests();
        return openRequests;
    }

    async onNewCardanoBlock(){
        console.log("New Cardano Block event");

    
    }

    async onNewBtcBlock(){
        let btcUtxos = await this.bitcoinWatcher.getUtxos();

        console.log(btcUtxos);
    }

    


}