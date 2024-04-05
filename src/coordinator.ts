import { cardanoWatcher } from "./cardano.js"
import { bitcoinWatcher } from "./bitcoin.js";
import EventEmitter from "events";
import { requestId } from "./helpers.js";
export const emitter = new EventEmitter();
import { decodedRequest, utxo } from "./types.js";
import { checkPrimeSync } from "crypto";

enum state {
    open,
    commited,
    payed,
    completed
}

interface paymentPaths{
    state: state,
    request?: decodedRequest,
    payment?: utxo[] | null,
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
                this.paymentPaths[index].request = request;
            }else if (requestId(this.paymentPaths[index].request) !==  requestId(request)){
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
    //////
      try{ 
          await  this.checkPayments() 
      }catch(e){
        console.log(e);
      }
    /////
    }

    async onNewBtcBlock(){
        console.log("New BTC Block event");       
        this.checkPayments() 
    }

    async checkPayments(){
 
        this.paymentPaths.forEach((path, index) => {
            console.log("path", path);
            if (path.state === state.commited){
                let payment = this.bitcoinWatcher.getUtxosByIndex(index);
                
                let sum = this.bitcoinWatcher.btcToSat(payment.reduce((acc, utxo) => acc + utxo.amount, 0));
                console.log("sum", sum);
                if(sum  >= path.request.decodedDatum.amount){
                    console.log("Payment found");
                    path.state = state.payed;
                    path.payment = payment;
                    this.cardanoWatcher.fulfillRequest(path.request.txHash, path.request.outputIndex, payment);
                }
            }
            
        });    
        
    }
}