import { bitcoinWatcher } from "./bitcoin"

const LOOP_INTERVAL = 1000

async function main() {
    console.log('Hello World')  
    const watcher = new bitcoinWatcher()
    while(!watcher.inSycn()){
        await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL));
    }

    console.log(watcher.getUtxosByIndex(1))
    try{
       await watcher.reddemIndex([1]);
    } catch (e) {
        console.log(e)
    }

}   

main()

