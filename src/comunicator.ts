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

interface RaftNode {
    id: string;
    currentTerm: number;
    votedFor: string | null;
    log: LogEntry[];
    commitIndex: number;
    lastApplied: number;
    ip: string;
    connection: net.Socket;
}

export class Communicator {
    private nodes: RaftNode[];
    private status: NodeStatus;
    private connections: net.Socket[];
    private peers: number[];
    private lucid: Lucid;

    constructor(topology: topology, secrets: secretsConfig , port: number) {
        this.connections = new Array(topology.topology.length).fill(null);
        this.peers = topology.topology.map((node) => node.port);
        this.nodes =  topology.topology.map((node) => ({
            id: node.name,
            currentTerm: 0,
            votedFor: null,
            log: [],
            commitIndex: 0,
            lastApplied: 0,
            ip: node.ip,
            connection: null
        }));
        (async () => {
            this.lucid = await Lucid.new();
            this.lucid.selectWalletFromSeed(secrets.seed);

            this.start(port);
        });
       
    }

    heartbeat() {

    }
  
    async handshake(socket){
        //random string
        const length = 32;
        const challenge = "challenge" + crypto.randomBytes(length).toString('hex');
        
        socket.write({"challengeStart": challenge });
        socket.on('data',async (data) => {
            const response = JSON.parse(data.toString());
            if(response.challengeResponce){
                const verified = this.lucid.verifyMessage(await this.lucid.wallet.address(),challenge, response.challengeResponce);
                if(!verified){
                    socket.end();
                    return;
                }
                const message = this.lucid.wallet.signMessage(await this.lucid.wallet.address() ,"hello")

            }
            console.log('Received data:', data.toString() , 'from', socket.remoteAddress, socket.remotePort);
        });
    }


    start(port: number) {
        // Create server
        const server = net.createServer((socket) => {
            // if (!this.peers.includes(socket.remotePort)) {
            //     console.log('Rejected connection from', socket.remoteAddress, socket.remotePort);
            //     socket.end();
            //     return;
            // }


            console.log('New client connected');
            socket.on('data', (data) => {
                console.log('Received data:', data.toString() , 'from', socket.remoteAddress, socket.remotePort);
            });
            socket.on('close', () => {
                console.log('Client disconnected');
                this.connections[this.peers.indexOf(socket.remotePort)] = null;
            });
            socket.on('error', (err) => {
                console.error(`Socket error: ${err}`);
                this.connections[this.peers.indexOf(socket.remotePort)] = null;
            });

        });

        server.listen(port, () => {
            console.log(`Server listening on port ${port}`);
        });

        for (let i = 0; i < this.peers.length; i++) {
            const peerPort = this.peers[i];
            const socket = net.createConnection({ port: peerPort }, () => {
                console.log(`Connected to peer on port ${peerPort}`);
                this.connections[i] = socket;
            }).on('error', (err) => {
                console.error(`Failed to connect to peer on port ${peerPort}:`, err);
            });
        }
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