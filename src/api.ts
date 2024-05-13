import express from 'express';
import {emitter}  from "./coordinator.js";

export default class ApiServer {
  private app: express.Express;
  private networkStatus: string = "unknown"
  private paymentPaths: string = "unknown"
  // console.log('Node:', node.id, 
  // node.incomingConnection ? true : false, 
  // node.outgoingConnection ? true : false,
  // node.state)
  constructor() {
    emitter.on('networkingStatus', (status) => {
      this.networkStatus = status
    })

    emitter.on('paymentPathsUpdate', (status) => {
      this.paymentPaths = status
    })
    
    this.app = express();
    this.app.set('json spaces', 2);

    this.app.get('/', (req, res) => {
      res.send('Hello World!');
    });

    // Add a status endpoint
    this.app.get('/status', (req, res) => {
      
      res.json({ status: 'OK', networkStatus: this.networkStatus, paymentPaths: this.paymentPaths });
    });

    this.app.get('/paymentPaths', (req, res) => {
      res.json({ paymentPaths: this.paymentPaths });
    });

    this.app.get('/networkStatus', (req, res) => {
      res.json({ networkStatus: this.networkStatus });
    });
    
  }

  start(port) {
    this.app.listen(port, () => {
      console.log(`Server listening at http://localhost:${port}`);
    });
  }
}

