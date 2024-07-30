import express from 'express';
import { ADAWatcher, BTCWatcher, communicator, coordinator } from './index.js';
export default class ApiServer {
  private app: express.Express;
  // console.log('Node:', node.id, 
  // node.incomingConnection ? true : false, 
  // node.outgoingConnection ? true : false,
  // node.state)
  constructor() {


    this.app = express();
    this.app.set('json spaces', 2);
    this.app.set('json replacer', function(key, value) {
      if (typeof value === 'bigint') {
        // Convert BigInt to string
        return value.toString();
      } else {
        // Return value as is
        return value;
      }
    });
    this.app.get('/',async (req, res) => {
      res.json(await ADAWatcher.getAddress())

    });

    this.app.get('/redemptionReqests', (req, res) => {  
      res.json({ redemptionRequests: ADAWatcher.getRedemptionRequests() });
    });

    this.app.get('/redemptionState',async (req, res) => {
      res.json({ redemptionState: await coordinator.getCurrentRedemption() });
    });
    // Add a status endpoint
    this.app.get('/status', (req, res) => {
      
      res.json({ status: 'OK', networkStatus: communicator.getNetworkStatus() });
    });

    this.app.get('/paymentPaths', (req, res) => {
      res.json({ paymentPaths: coordinator.getPaymentPaths()  });
    });

    this.app.get("/paymentPaths/:index", (req, res) => {
      const paymentPaths = coordinator.getPaymentPaths()
      res.json({ paymentPaths: paymentPaths[Number(req.params.index)] , index : req.params.index });
    });

    this.app.get('/utxos', (req, res) => {
      const utxos = BTCWatcher.getLoadedUtxos();
      res.json({ utxos: utxos });
    });

    this.app.get('/utxos/:index', (req, res) => {
      const utxos = BTCWatcher.getUtxosByIndex(req.params.index);
      res.json({ utxos });
    });

    
    this.app.get('/vault', (req, res) => {
      //the last elemet in the array is the vault
      const utxos = BTCWatcher.getVaultUtxos();
      res.json({ vault: utxos });  
    });

    this.app.get('/networkStatus', (req, res) => {
      res.json({ networkStatus: communicator.getNetworkStatus() });
    });

    this.app.get('/requests', (req, res) => {
      res.json({ requests: coordinator.getOpenRequests() });
    });
  }

  start(port) {
    this.app.listen(port, () => {
      console.log(`Server listening at http://localhost:${port}`);
    });
  }
}

