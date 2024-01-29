import { cardanoWatcher } from "./cardano.js"
import { bitcoinWatcher } from "./bitcoin.js";

const LOOP_INTERVAL = 1000


async function main() {
   const watcher = new bitcoinWatcher()
   const ADAWatcher = new cardanoWatcher()
   // while(!watcher.inSycn()){
   //     await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL));
    //}
    console.log("cardano watcher");

    //console.log(watcher.getUtxosByIndex(1))
    try{
      
    } catch (e) {
        console.log(e)
    }
}   

main()

