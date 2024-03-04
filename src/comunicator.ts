import { emmiter } from './coordinator';
import { topology, secretsConfig } from './types';
import { Server } from 'socket.io';
import Client  from 'socket.io-client';
import { Lucid } from 'lucid-cardano';
import crypto from 'crypto';

enum NodeStatus {
    Learner = 'learner',
    Follower = 'follower',
    Candidate = 'candidate',
    Monitor = 'monitor',
    Leader = 'leader',
    Unverified = 'unverified',
    Disconnected = 'disconnected'
}

interface LogEntry {
    term: number;
    command: any;
}

interface angelPeer {
    id: string;
    currentTerm: number;
    votedFor: string | null;
    lastApplied: number;
    ip: string;
    port: number;
    address: string;
    outgoingConnection: any;
    incomingConnection: any;
    state: NodeStatus;
}


export class Communicator {
    private peers: angelPeer[];
    private lucid: Lucid;
    private address: string;
    private Iam: number;
    constructor(topology: topology, secrets: secretsConfig , port: number) {
        this.heartbeat = this.heartbeat.bind(this);

        (async () => {
            try {
                this.lucid = await Lucid.new();
                this.lucid.selectWalletFromSeed(secrets.seed);
                const pubKey =  this.lucid.utils.getAddressDetails(await this.lucid.wallet.address()).paymentCredential.hash;
                //fing pubkey in topology or throw error

                const found = topology.topology.findIndex((node: { AdaPkHash: string }) => node.AdaPkHash === pubKey);
                console.log('Pubkey:', pubKey, found);
                if(found == -1){
                    throw new Error('Pubkey not found in topology');
                }
                this.Iam = found;
                this.address = this.lucid.utils.credentialToAddress({type: "Key", hash: pubKey});
                this.peers = initializeNodes(topology, this.lucid);
                this.start(port);


            } catch (err) {
                console.error('Error starting lucid:', err);
            }
        })();

        setInterval(this.heartbeat, 5000);
        

        function initializeNodes(topology: topology, lucid: Lucid) {
            return topology.topology.map((node) => {
                return {
                    id: node.name,
                    currentTerm: 0,
                    votedFor: null,
                    log: [],
                    lastApplied: 0,
                    port: node.port,
                    ip: node.ip,
                    address: lucid.utils.credentialToAddress({type: "Key", hash: node.AdaPkHash}) ,
                    outgoingConnection: null,
                    incomingConnection: null,
                    state: NodeStatus.Disconnected
                };
            });
        }
    }

    start(port: number) {
        console.log("starting server")
        // Create server
        const io = new Server(port);
        io.on('connection', (socket) => {
            console.log('Client connected');
            this.handShake(socket);
        });

        for (let i = 0; i < this.peers.length; i++) {
            if(i !== this.Iam )   this.connect(i);
        }
    }

    heartbeat() {
        console.log('Sending heartbeat');
    
        this.peers.forEach(node => {
            console.log('Node:', node.id, node.incomingConnection ? true : false, node.outgoingConnection ? true : false)
            if (node.incomingConnection) {
                node.incomingConnection.write(JSON.stringify({ heartbeat: true }));
            }
            if (node.outgoingConnection) {
                node.outgoingConnection.emit('heartbeat');
                
            }
        })
    }

    private stringToHex(str: string) {
        return Buffer.from(str).toString('hex');
    }

    private async handShake(socket: any) {
         const challenge = "challenge" + crypto.randomBytes(32).toString('hex');
         console.log("Starting handshake")
         socket.emit('challenge', challenge);
         socket.on('challengeResponse', async (response) => {
            console.log("Challenge response received")
            const verified = this.lucid.verifyMessage(response.address ,this.stringToHex(challenge), response);
            if(verified){
                const peerindex = this.peers.findIndex(peer => peer.address === response.address);
                console.log(peerindex,response)
                console.log(this.peers)
              //  this.applyRuntimeListeners(socket);
                this.peers[peerindex].incomingConnection = socket;
            }else{
                socket.disconnect();
            }
            }
        );

        
        // socket.write(JSON.stringify({ "challenge": challenge }));
        // socket.on('data',async (data) => {
        //     const response = JSON.parse(data.toString());
        //     if(response.challengeResponse){
        //         const verified = this.lucid.verifyMessage(response.challengeResponse.address ,this.stringToHex(challenge), response.challengeResponse);
        //         if(verified){
        //             console.log(peerindex)
               
        //             this.applyRuntimeListeners(socket);

        //             this.peers[peerindex].incomingConnection = socket;
        //         }else{
        //             socket.disconnect();
        //     }}

        //     if(response.challenge){
        //         const message : Object= await this.lucid.wallet.signMessage(this.address, this.stringToHex(response.challenge));
        //         console.log(message)
        //         message["address"] = this.address;
        //         socket.write(JSON.stringify({ challengeResponse: message }));
        //     }
        // });

    }
  
    private  applyRuntimeListeners(socket: any) {
        socket.removeAllListeners();
        socket.on('data', (data) => {
            console.log('Received data:', data.toString() , 'from', socket.remoteAddress, socket.remotePort);
        });
        socket.on('close', () => {
            console.log('Client disconnected');
            this.peerDisconnected(socket);
        });
        socket.on('error', (err) => {
            console.error(`Socket error: ${err}`);
            this.peerDisconnected(socket);
        });
        
    }



    peerDisconnected(id: number) {
        // const index = this.nodes.findIndex(node => node.port === socket.remotePort);
        // if (index !== -1) {
        //     console.log(`Peer ${this.nodes[index].id} disconnected`);
        //     this.nodes[index].connection = null;
        // } else {
        //     console.log(`Peer on port ${socket.remotePort} not found`);
        // }
    }


    private async connect(i: number) {
        const peerPort = this.peers[i].port;
        const socket = Client(`http://localhost:${peerPort}`);
        socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.peers[i].outgoingConnection = null;

        });

        socket.on('connect_error', (error) => {
            console.log('Connection Error');
            socket.disconnect();
            this.peers[i].outgoingConnection = null;

        });
        
        socket.on('connect_timeout', () => {
            console.log('Connection Timeout');
            
            socket.disconnect();
            this.peers[i].outgoingConnection = null;

        });


        socket.on('challenge', async (challenge) => {
            console.log("Challenge received")
            const message : Object= await this.lucid.wallet.signMessage(this.address, this.stringToHex(challenge));
            message["address"] = this.address;
            socket.emit('challengeResponse', message);
        });

        this.peers[i].outgoingConnection = socket;
    }

    broadcast(message) {
        // for (let socket of this.nodes.map(peer => peer.connection)) {
        //    if(socket)  socket.write(message);
        // }
    }




}