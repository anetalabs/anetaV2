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

        io.on('disconnect', () => {
            console.log('Client disconnected REEEEEE');
        });

        for (let i = 0; i < this.peers.length; i++) {
            if(i !== this.Iam )   this.connect(i);
        }
    }

    heartbeat() {
        console.log('Sending heartbeat');
    
        this.peers.forEach((node, index) => {
            console.log('Node:', node.id, 
                                 node.incomingConnection ? true : false, 
                                 node.outgoingConnection ? true : false,
                                 node.state)

            if (node.incomingConnection) {
                node.incomingConnection.emit('heartbeat');
            }
            if (node.outgoingConnection) {
                node.outgoingConnection.emit('heartbeat');
                
            }else if(index !== this.Iam){
                this.connect(index);
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

                this.applyRuntimeListeners(socket,peerindex);
                this.peers[peerindex].incomingConnection = socket;
            }else{
                socket.disconnect();
            }
            }
        );
    }


    private getLeader() {
        return this.peers.find(peer => peer.state === NodeStatus.Leader);
    }

    private  applyRuntimeListeners(socket: any, index: number) {
        // socket.removeAllListeners();
        socket.on('heartbeat', () => {  
            console.log('Received incoming heartbeat from', this.peers[index].id);
        });

        socket.on('data', (data) => {
            console.log('Received data:', data.toString() , 'from', socket.remoteAddress, socket.remotePort);
        });
 
        socket.on('disconnect', () => {
            console.log('Client disconnected');
            
            this.peers[index].incomingConnection = null;
            socket.disconnect();
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
        this.peers[i].outgoingConnection = socket;

        socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.peers[i].outgoingConnection = null;

        });

        socket.on('heartbeat', () => {  
            console.log('Received outgoing heartbeat from', this.peers[i].id);
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

    }

    broadcast(message) {
        // for (let socket of this.nodes.map(peer => peer.connection)) {
        //    if(socket)  socket.write(message);
        // }
    }




}