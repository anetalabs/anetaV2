import { bitcoinWatcher } from "./bitcoin"
import { cardanoWatcher } from "./cardano"

const LOOP_INTERVAL = 1000

async function main() {
    console.log('Hello World')  
    const ADAWatcher = new cardanoWatcher()
   // while(!watcher.inSycn()){
   //     await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL));
    //}

    //console.log(watcher.getUtxosByIndex(1))
    try{
      
    } catch (e) {
        console.log(e)
    }
}   

main()

