import { emmiter } from './coordinator';
import { topology, secretsConfig } from './types';
import { Server, Socket as ServerSocket } from 'socket.io';
import { Socket as ClientSocket } from 'socket.io-client';
import  Client  from 'socket.io-client';
import { Lucid } from 'lucid-cardano';
import crypto from 'crypto';

const HEARTBEAT = 2000;
const ELECTION_TIMEOUT = 5;

enum NodeStatus {
    Learner = 'learner',
    Follower = 'follower',
    Candidate = 'candidate',
    Monitor = 'monitor',
    Leader = 'leader',
    Disconnected = 'disconnected'
}

interface vote {
    candidate: number;
    time: number;
    voter: string;
}

interface angelPeer {
    id: string;
    currentTerm: number;
    votedFor: number | null;
    lastApplied: number;
    ip: string;
    port: number;
    address: string;
    outgoingConnection: ClientSocket | null;
    incomingConnection: ServerSocket | null;
    state: NodeStatus;
}


export class Communicator {
    private peers: angelPeer[];
    private lucid: Lucid;
    private address: string;
    private topology: topology;
    private leaderTimeout: Date;
    private Iam: number;
    constructor(topology: topology, secrets: secretsConfig , port: number) {
        this.heartbeat = this.heartbeat.bind(this);
        this.topology = topology;
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
                this.peers = initializeNodes(topology, this.lucid, this.Iam);
                this.start(port);


            } catch (err) {
                console.error('Error starting lucid:', err);
            }
        })();

        setInterval(this.heartbeat, HEARTBEAT);
        
        this.leaderTimeout = new Date();
        function initializeNodes(topology: topology, lucid: Lucid, Iam: number ) {
            return topology.topology.map((node, index) => {
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
                    state: index === Iam ? NodeStatus.Learner : NodeStatus.Disconnected
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
            console.log('Client disconnected');
        });

        for (let i = 0; i < this.peers.length; i++) {
            if(i !== this.Iam )   this.connect(i);
        }
    }

    election() {
        if(this.peers[this.Iam].state in [NodeStatus.Leader,NodeStatus.Candidate, NodeStatus.Monitor] ) return;

        console.log('Leader timeout, starting election');
        this.leaderTimeout = new Date();
        let newLeader : number = -1;
        //seet all nodes to monitor
        this.peers.forEach((node, index) => {
            if(index !== this.Iam && node.state !== NodeStatus.Disconnected){
                node.state = NodeStatus.Monitor;
                node.votedFor = null;
            }
        });
        for (let i = 0; i < this.peers.length; i++) {
            if (this.peers[i].incomingConnection || i === this.Iam) {
                newLeader = i;
                this.peers[i].state = NodeStatus.Candidate;
                this.peers[this.Iam].votedFor = i;

                break;
            }
        }

        this.vote(newLeader);
        setTimeout(() => {
            const leader = this.getLeader();

            if (leader !== null) {
                console.log('Leader elected:', leader);
                this.peers[leader].state = NodeStatus.Leader;
                if(this.Iam !== leader) {
                    this.peers[this.Iam].state = NodeStatus.Follower;
                    this.broadcast('statusUpdate', NodeStatus.Follower);
                }
                this.leaderTimeout = new Date();
            } else {
                console.log('No leader elected', leader);
            }
        }, HEARTBEAT );
    }

    vote = async function (candidate: number, peer : angelPeer = null) {
        console.log('Voting for:', candidate);
        let vote = {
            candidate: candidate,
            time : new Date().getTime(),
            voter: this.address
        } 
    
        if(peer && peer.outgoingConnection ){
            peer.outgoingConnection.emit('vote', {vote: JSON.stringify(vote), signature: await this.lucid.wallet.signMessage(this.peers[this.Iam].address, this.stringToHex(JSON.stringify(vote)))});
        }else {
            this.peers.forEach(async (node : angelPeer) => {
                if (node.outgoingConnection) {
                    node.outgoingConnection.emit('vote', {vote: JSON.stringify(vote), signature: await this.lucid.wallet.signMessage(this.peers[this.Iam].address, this.stringToHex(JSON.stringify(vote)))});
                }
            
            });
        }
    }

    heartbeat() {
        
        if(this.peers[this.Iam].state === NodeStatus.Leader){
            this.broadcast('heartbeat');
        }else{ 
            if( new Date().getTime() - new Date(this.leaderTimeout).getTime() > ELECTION_TIMEOUT * HEARTBEAT){
                this.election();
            }
        }
        if(  [NodeStatus.Learner, NodeStatus.Monitor, NodeStatus.Candidate].includes(this.peers[this.Iam].state)  && this.getLeader() !== null){
            if(this.getLeader() === this.Iam){
                 this.peers[this.Iam].state = NodeStatus.Leader;
            }else{
                 this.peers[this.Iam].state = NodeStatus.Follower;
                 this.broadcast('statusUpdate', NodeStatus.Follower);
            }
        }
        
        console.log('leaderTimeout:', new Date(this.leaderTimeout).getTime() - new Date().getTime());
        this.peers.forEach((node, index) => {
            console.log('Node:', node.id, 
            node.incomingConnection ? true : false, 
            node.outgoingConnection ? true : false,
            node.state)
            
            if(node.outgoingConnection === null ){
                this.connect(index);
            }
            if ([NodeStatus.Monitor, NodeStatus.Learner, NodeStatus.Candidate].includes(node.state)) { 
                let leader = this.getLeader();
                if (leader !== null) this.vote(this.getLeader(), node);
            }
            

        })
    }

    private stringToHex(str: string) {
        return Buffer.from(str).toString('hex');
    }

    private async handShake(socket: ServerSocket) {
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
                socket.emit('authenticationAccepted');
                
            }else{
                socket.disconnect();
            }
            }
        );
    }



    private getLeader() {
        // get the node with the most votes 
        let leader = null;
        for(let i = 0; i < this.peers.length; i++){
          if( this.peers.filter((node) => node.votedFor === i).length >= this.topology.m){
            leader = i;
          }

        }

        // if the node has more than half of the votes return it
        return leader;
    }

    private  applyRuntimeListeners(socket: ServerSocket, index: number) {
        
        // socket.removeAllListeners();
        socket.on('heartbeat', () => {  
         //   console.log('Received incoming heartbeat from', this.peers[index].id);
            if(this.peers[index].state === NodeStatus.Leader){
                this.leaderTimeout =  new Date();
            }
        });


        socket.on('statusUpdate', (status) => {
            console.log('Status update:', status);
            if(status === NodeStatus.Leader){
                console.log('illigal status update from:', this.peers[index].id, 'to leader, ignoring...');
               // this.applyPunitveMeasures(socket);
            }
            this.peers[index].state = status;
        });

        socket.on('vote', (vote ) => {   
            try{
                const decodedVote : vote= JSON.parse(vote.vote);
                const verified = this.lucid.verifyMessage(decodedVote.voter ,this.stringToHex(vote.vote), vote.signature);
                const addressIsPeer = (this.peers.findIndex(peer => peer.address === decodedVote.voter) !== -1);
                if(verified && addressIsPeer && Math.abs(decodedVote.time - new Date().getTime() ) < HEARTBEAT){
                    console.log('Valid vode from:', decodedVote.voter, 'for:', decodedVote.candidate);
                    this.peers[index].votedFor = decodedVote.candidate;
                }else{  
                    console.log('Vote not verified');
                }
        
            }catch(err){
                console.log(err);
            }
        }
        );


        socket.on('data', (data) => {
            console.log('Received data:', data.toString() , 'from', socket.handshake.address);
        });
 
        socket.on('disconnect', () => {
            console.log('Client disconnected');
            
            this.peers[index].incomingConnection = null;
            this.peers[index].state = NodeStatus.Disconnected;
            socket.disconnect();
        });
    }

    private applyPunitveMeasures(peer: angelPeer) {
        console.log('Applying punitive measures');
        if (peer.incomingConnection) peer.incomingConnection.disconnect();
        if (peer.outgoingConnection) peer.outgoingConnection.disconnect();
    }

    private async connect(i: number) {
        const peerPort = this.peers[i].port;
        const socket = Client(`http://localhost:${peerPort}`);
        this.peers[i].outgoingConnection = socket;

        socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.peers[i].outgoingConnection = null;
            this.peers[i].state = NodeStatus.Disconnected;


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

        socket.on('authenticationAccepted', () => {

            console.log('Authentication accepted');
            this.peers[i].outgoingConnection.emit("statusUpdate", this.peers[this.Iam].state);
        });

    }

    broadcast(method, params= undefined) {
        this.peers.forEach((node, index) => {
            if (node.outgoingConnection) {
                node.outgoingConnection.emit(method, params);
            }
        });
    }




}