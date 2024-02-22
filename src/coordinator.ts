import { cardanoWatcher } from "./cardano.js"
import { bitcoinWatcher } from "./bitcoin.js";

export class coordinator{
    cardanoWatcher: cardanoWatcher
    bitcoinWatcher: bitcoinWatcher

    constructor(cardanoWatcher : cardanoWatcher, bitcoinWatcher : bitcoinWatcher){
        this.cardanoWatcher = cardanoWatcher;
        this.bitcoinWatcher = bitcoinWatcher;
    }

    async getOpenRequests(){
        let openRequests = await this.cardanoWatcher.getOpenRequests();
        return openRequests;
    }

    async onNewBtcBlock(){
        let openRequests = await this.getOpenRequests();
        console.log(openRequests);
    }
    


}