import { bitcoinWatcher } from "./bitcoin"

const LOOP_INTERVAL = 1000

async function main() {
    console.log('Hello World')  
    const watcher = new bitcoinWatcher()

}   

main()

