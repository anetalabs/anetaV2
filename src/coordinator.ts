import { cardanoWatcher } from "./cardano.js"
import { bitcoinWatcher } from "./bitcoin.js";
import EventEmitter from "events";
import { requestId } from "./helpers.js";
export const emitter = new EventEmitter();

enum state {
    open,
    commited,
    payed,
    completed
}

interface paymentPaths{
    state: state,
    request?: string | null,
    payment?: string | null,
    fulfillment?: string | null
} 

export class coordinator{
    cardanoWatcher: cardanoWatcher
    bitcoinWatcher: bitcoinWatcher
    paymentPaths: paymentPaths[]

    constructor(cardanoWatcher : cardanoWatcher, bitcoinWatcher : bitcoinWatcher){
        this.cardanoWatcher = cardanoWatcher;
        this.bitcoinWatcher = bitcoinWatcher;
        
        this.paymentPaths = Array.from({length: this.bitcoinWatcher.getPaymentPaths()}, (_, index) => index).map((index) => {return {state: state.open}});
        this.getOpenRequests = this.getOpenRequests.bind(this);
        this.onNewCardanoBlock = this.onNewCardanoBlock.bind(this);

        emitter.on("newCardanoBlock", this.onNewCardanoBlock);
        emitter.on("newBtcBlock", this.onNewBtcBlock.bind(this));

    }

    async getOpenRequests(){
        let openRequests = await this.cardanoWatcher.queryValidRequests();
        openRequests.forEach((request) => {
            const index = request.decodedDatum.path;
            
            if (this.paymentPaths[index].state === state.open){
                this.paymentPaths[index].state = state.commited;
                this.paymentPaths[index].request = requestId(request);
            }else if (this.paymentPaths[index].request !==  requestId(request)){
                console.log("Payment Pathway already in use, rejecting request");
                this.cardanoWatcher.rejectRequest(request.txHash, request.outputIndex);
            }
        });
        return openRequests;
        
    }

    async onNewCardanoBlock(){
      console.log("New Cardano Block event");
      console.log(this.paymentPaths)
      await this.getOpenRequests();
    
    }
    async onNewBtcBlock(){
        console.log("New BTC Block event");        
    }
}