import { emmiter } from './coordinator';
import { topology, secretsConfig } from './types';
import net from 'net';
import { Lucid } from 'lucid-cardano';
import crypto from 'crypto';

enum NodeStatus {
    Learner = 'learner',
    Follower = 'follower',
    Candidate = 'candidate',
    Monitor = 'monitor',
    Leader = 'leader'
}

interface LogEntry {
    term: number;
    command: any;
}

interface angelPeer {
    id: string;
    currentTerm: number;
    votedFor: string | null;
    log: LogEntry[];
    commitIndex: number;
    lastApplied: number;
    ip: string;
    port: number;
    address: string;
    connection: net.Socket;
}


export class Communicator {
    private nodes: angelPeer[];
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
                this.nodes = initializeNodes(topology);
                this.start(port);


            } catch (err) {
                console.error('Error starting lucid:', err);
            }
        })();

        setInterval(this.heartbeat, 1000);
        

        function initializeNodes(topology: topology) {
            return topology.topology.map((node) => {
                return {
                    id: node.name,
                    currentTerm: 0,
                    votedFor: null,
                    log: [],
                    commitIndex: 0,
                    lastApplied: 0,
                    port: node.port,
                    ip: node.ip,
                    address: node.AdaPkHash,
                    connection: null
                };
            });
        }
    }


    heartbeat() {
        console.log('Sending heartbeat');
        this.nodes.forEach(node => {
            if (node.connection) {
                node.connection.write(JSON.stringify({ heartbeat: true }));
            }
        })
    }

    private stringToHex(str: string) {
        return Buffer.from(str).toString('hex');
    }
  
    private async handsakeListener(socket){
        // Step 2: Listener sends challenge
        const challenge = "challenge" + crypto.randomBytes(32).toString('hex');
        console.log("Starting handshake")
        socket.write(JSON.stringify({ "challengeStart": challenge }));

        socket.on('data',async (data) => {
            const response = JSON.parse(data.toString());

            // Step 4: Listener verifies challenge, solves counterchallenge, and response with solution
            if(response.challengeResponse){
                const address = response.address;
                console.log('Address:', address);
                const verified = this.lucid.verifyMessage(response.address ,this.stringToHex(challenge), response.challengeResponse);
                if(!verified){
                    console.log('Rejected connection from', socket.remoteAddress, socket.remotePort);
                    socket.end();
                    return;
                } else {
                    const counterChallenge = response.counterChallenge;
                    const message = await this.lucid.wallet.signMessage(this.address, this.stringToHex(counterChallenge));
                    socket.write(JSON.stringify({ counterChallengeResponse: message, address: this.address }));

                    // Step 6: Listener adds the socket into the corresponding peers list
                    const peerindex = this.nodes.findIndex(node => this.lucid.utils.credentialToAddress({type: "Key", hash: node.address}) === response.address);
                    console.log(peerindex)
                    this.nodes[peerindex].connection = socket;
            }
            }

            // Step 5: Initiator verifies counterChallenge, and sends acknowledgement
            if(response.counterChallengeResponse){
                const verified = this.lucid.verifyMessage(response.address ,this.stringToHex(challenge), response.counterChallengeResponse);
                if(verified){
                    socket.write(JSON.stringify({ acknowledgement: true }));
                }
            }
        });

    }

    private async handshakeInitiator(socket){
        const challenge = "challenge" + crypto.randomBytes(32).toString('hex');

        socket.on('data',async (data) => {
            const decodedData =  JSON.parse(data.toString());

            // Step 3: Initiator signs challenge and replies with solution + counter
            if (Object.keys(decodedData).includes('challengeStart')) {
                const incomingChallenge =   decodedData["challengeStart"]

                console.log('Received challenge:', incomingChallenge);
                const challengeHex = this.stringToHex(incomingChallenge);
                if(incomingChallenge.startsWith('challenge') === false){
                    console.log('Rejected connection from', socket.remoteAddress, socket.remotePort);
                    socket.end();
                    return;
                }
                const message = await this.lucid.wallet.signMessage(this.address, challengeHex);
                socket.write(JSON.stringify({ challengeResponse: message , address: this.address, counterChallenge: challenge}));
            }

            // Step 5: Initiator verifies counterChallenge, and sends acknowledgement
            if (Object.keys(decodedData).includes('counterChallengeResponse')) {
                const incomingCounterChallenge = decodedData["counterChallengeResponse"];
                const verified = this.lucid.verifyMessage(decodedData.address, this.stringToHex(challenge), incomingCounterChallenge);
                if(verified){
                    socket.write(JSON.stringify({ acknowledgement: true }));

                    // Step 6: Initiator adds the socket into the corresponding peers list
                    const peerindex = this.nodes.findIndex(node => this.lucid.utils.credentialToAddress({type: "Key", hash: node.address}) === decodedData.address);
                    console.log('Peer index:', peerindex);
                    this.nodes[peerindex].connection = socket;
                }
            }
        });
    }


    start(port: number) {
        console.log("starting server")
        // Create server
        const server = net.createServer((socket) => {
            // if (!this.peers.includes(socket.remotePort)) {
            //     console.log('Rejected connection from', socket.remoteAddress, socket.remotePort);
            //     socket.end();
            //     return;
            // }

            this.handshakeInitiator(socket)
            console.log('New client connected');
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

        });


        server.listen(port, () => {
            console.log(`Server listening on port ${port}`);
        });

        for (let i = 0; i < this.nodes.length; i++) {
            
            //connect if not me
            if(i !== this.Iam)
                this.connect(i);
        }
    }

    peerDisconnected(socket: net.Socket) {
        const index = this.nodes.findIndex(node => node.port === socket.remotePort);
        if (index !== -1) {
            console.log(`Peer ${this.nodes[index].id} disconnected`);
            this.nodes[index].connection = null;
        } else {
            console.log(`Peer on port ${socket.remotePort} not found`);
        }
    }


    private async connect(i: number) {
        const peerPort = this.nodes[i].port;
        const socket = net.createConnection({ port: peerPort }, () => {
            console.log(`Connected to peer on port ${peerPort}`);
            this.nodes[i].connection = socket;
        }).on('error', (err) => {
            console.error(`Failed to connect to peer on port ${peerPort}:`, err);
        });

        this.handsakeListener(socket);
    }

    broadcast(message) {
        for (let socket of this.nodes.map(peer => peer.connection)) {
           if(socket)  socket.write(message);
        }
    }

    addNode(id: string, port: number) {

     }

     getStatus(){
        return 
     }

    removeNode(id: string) {

    }


}