import express from 'express';
import {emitter}  from "./coordinator.js";
import { ADAWatcher, communicator, coordinator } from './index.js';
export default class ApiServer {
  private app: express.Express;
  private networkStatus: string = "unknown"
  private paymentPaths: string = "unknown"
  private utxos: any[] = []
  private requests: any[] = []
  // console.log('Node:', node.id, 
  // node.incomingConnection ? true : false, 
  // node.outgoingConnection ? true : false,
  // node.state)
  constructor() {
    emitter.on('networkingStatus', (status) => {
      this.networkStatus = status
    })


    emitter.on("newUtxos", (utxos) => {
      this.utxos = utxos
    })

    emitter.on("requestsUpdate", (requests) => {
      this.requests = requests
    })
    
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
    this.app.get('/', (req, res) => {
      res.send('Hello World!');
    });

    this.app.get('/redemptionReqests', (req, res) => {  
      res.json({ redemptionRequests: ADAWatcher.getRedemptionRequests() });
    });
    // Add a status endpoint
    this.app.get('/status', (req, res) => {
      
      res.json({ status: 'OK', networkStatus: this.networkStatus, paymentPaths: coordinator.getPaymentPaths() });
    });

    this.app.get('/paymentPaths', (req, res) => {
      res.json({ paymentPaths: coordinator.getPaymentPaths()  });
    });

    this.app.get("/paymentPaths/:index", (req, res) => {
      res.json({ paymentPaths: this.paymentPaths[req.params.index] });
    });

    this.app.get('/utxos', (req, res) => {
      res.json({ utxos: this.utxos });
    });

    this.app.get('/utxos/:index', (req, res) => {
      res.json({ utxos: this.utxos[req.params.index] });
    });

    
    this.app.get('/vault', (req, res) => {
      //the last elemet in the array is the vault
      res.json({ vault: this.utxos[this.utxos.length - 1] });  
    });

    this.app.get('/networkStatus', (req, res) => {
      res.json({ networkStatus: this.networkStatus });
    });

    this.app.get('/requests', (req, res) => {
      res.json({ requests: this.requests });
    });
  }

  start(port) {
    this.app.listen(port, () => {
      console.log(`Server listening at http://localhost:${port}`);
    });
  }
}

