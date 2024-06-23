import { ADAWatcher, BTCWatcher, coordinator } from './index.js';
import { emitter } from './coordinator.js';
import { topology, secretsConfig, pendingCardanoTransaction, pendingBitcoinTransaction, NodeStatus, redemptionController , redemptionState } from './types.js';
import { Server, Socket as ServerSocket } from 'socket.io';
import { Socket as ClientSocket } from 'socket.io-client';
import  Client  from 'socket.io-client';
import * as Lucid  from 'lucid-cardano';
import crypto from 'crypto';
const HEARTBEAT = 5000;
const ELECTION_TIMEOUT = 5;



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
    connectionTime : Date;
    ip: string;
    port: number;
    address: string;
    keyHash:  string;
    outgoingConnection: ClientSocket | null;
    incomingConnection: ServerSocket | null;
    state: NodeStatus;
}


export class Communicator {
    private peers: angelPeer[];
    private lucid: Lucid.Lucid;
    private address: string;
    private topology: topology;
    private leaderTimeout: Date;
    private transactionsBuffer: pendingCardanoTransaction[] = [];
    private btcTransactionsBuffer: pendingBitcoinTransaction[] = [];
    private Iam: number;
    constructor(topology: topology, secrets: secretsConfig , port: number) {
        this.heartbeat = this.heartbeat.bind(this);


        this.topology = topology;
        (async () => {
            try {
                this.lucid = await Lucid.Lucid.new();
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
                //while not synced delay 
  
                while(!(ADAWatcher.inSync() && BTCWatcher.inSync())){
                    await new Promise((resolve) => setTimeout(resolve, 5000));
                    console.log(`Waiting for ${!ADAWatcher.inSync()? "Cardano-Watcher " : "" }${!BTCWatcher.inSync()? "Bitcoin-Watcher " : "" }sync`);
                }
                this.start(port);
                setInterval(this.heartbeat, HEARTBEAT);
                this.leaderTimeout = new Date();

                 
            } catch (err) {
                console.error('Error starting lucid:', err);
            }
        })();

        
        
        function initializeNodes(topology: topology, lucid: Lucid.Lucid, Iam: number ) {
            return topology.topology.map((node, index) => {
                return {
                    id: node.name,
                    currentTerm: 0,
                    votedFor: null,
                    log: [],
                    connectionTime: undefined,
                    lastApplied: 0,
                    port: node.port,
                    ip: node.ip,
                    address: lucid.utils.credentialToAddress({type: "Key", hash: node.AdaPkHash}) ,
                    keyHash: node.AdaPkHash, 
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

    private election() {
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
        this.broadcast('voteRequest');

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
            const leader = this.countVotes();
            
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
        }, HEARTBEAT * 2 );
    }

    private vote = async function (candidate: number, peer : angelPeer = null) {
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

    signatureResponse(data: {txId: string, signature: string}) {
       
            const leader = this.peers[this.getLeader()];
            if(leader && leader.outgoingConnection){
                console.log('Sending signature response:', data);
                leader.outgoingConnection.emit('signatureResponse', data);
            }
            
      
    }

    getQuorum() : string[]{
     // get the n nodes with the oldest connection time
        const quorum = this.peers
            .filter((node) => node.state === NodeStatus.Follower)
            .sort((a, b) => a.connectionTime.getTime() - b.connectionTime.getTime())
            .slice(0, this.topology.m-1)
            .map((node) => node.address);
        quorum.push(this.address);
        return(quorum);
    }

    

    amILeader() : boolean {
        return this.peers[this.Iam].state === NodeStatus.Leader;
    }

    cardanoTxToComplete(data: pendingCardanoTransaction) {
        if(this.peers[this.Iam].state === NodeStatus.Leader  && !this.transactionsBuffer.find((tx) => tx.txId === data.txId) ){
            const tx = data
            tx.status = "pending"
           this.transactionsBuffer.push(tx);
           console.log('Transaction to complete:', data);
       }

    }

    bitcoinTxToComplete(tx: pendingBitcoinTransaction) {
        if(this.peers[this.Iam].state === NodeStatus.Leader && !this.btcTransactionsBuffer.find((innerTx) => tx.tx.toHex() === innerTx.tx.toHex()) ){
            this.btcTransactionsBuffer.push(tx);
            console.log('Bitcoin transaction to complete:', tx);

        }
    }

    private heartbeat() : void {
        

        if(this.peers[this.Iam].state === NodeStatus.Leader){
            this.broadcast('heartbeat');
            this.gatherSignatures();

        }else{ 
            if( new Date().getTime() - new Date(this.leaderTimeout).getTime() > ELECTION_TIMEOUT * HEARTBEAT){
                this.election();
            }
        }
        if(  [NodeStatus.Learner, NodeStatus.Monitor, NodeStatus.Candidate].includes(this.peers[this.Iam].state)  && this.countVotes() !== null){
            if(this.getLeader() === this.Iam){
                 this.peers[this.Iam].state = NodeStatus.Leader;
            }else{
                 this.peers[this.Iam].state = NodeStatus.Follower;
                 this.broadcast('statusUpdate', NodeStatus.Follower);
            }
        }
        
        this.peers.forEach((node, index) => {
         
            
            if(node.outgoingConnection === null ){
                this.connect(index);
            }
            if ([NodeStatus.Monitor, NodeStatus.Learner, NodeStatus.Candidate].includes(node.state)) { 
                let leader = this.getLeader();
                if (leader !== null) this.vote(this.getLeader(), node);
            }
            

        })

        const peerStatus = this.peers.map((node) => {
            return {
                id: node.id,
                incomingConnection: node.incomingConnection ? true : false,
                outgoingConnection: node.outgoingConnection ? true : false,
                state: node.state,
                connectionTime: node.connectionTime
            };
        });

        emitter.emit('networkingStatus', {peers: peerStatus, leaderTimeout : new Date(this.leaderTimeout).getTime() - new Date().getTime() });
    }

    private stringToHex(str: string) : string {
        return Buffer.from(str).toString('hex');
    }

    private handShake(socket: ServerSocket) : void{
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
                this.peers[peerindex].connectionTime = new Date();
                socket.emit('authenticationAccepted');
                
            }else{
                socket.disconnect();
            }
            }
        );
    }


    private countVotes() {
        let leader = null;
        for(let i = 0; i < this.peers.length; i++){
          if( this.peers.filter((node) => node.votedFor === i).length >= this.topology.m){
            leader = i;
          }

        }

        return leader;
    }
    private getLeader() {
        let leader = null;
        for(let i = 0; i < this.peers.length; i++){
          if( this.peers.filter((node) => node.votedFor === i).length >= this.topology.m){
            leader = i;
          }

        }
        if(leader === null){
           leader =  this.peers[this.Iam].votedFor 
        }
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
                    this.peers[index].votedFor = decodedVote.candidate;
                }else{  
                    console.log('Vote not verified');
                }
        
            }catch(err){
                console.log(err);
            }
        }
        );        

        socket.on('voteRequest', () => {
            this.vote(this.getLeader(), this.peers[index]);
        });

        socket.on('queryRedemption', async () => {
            if(this.peers[index].state !== NodeStatus.Leader) return;
            const redemption = await coordinator.getRedemptionState();
            if(redemption.state !== redemptionState.open ){
                this.peers[index].outgoingConnection.emit('newRedemption', redemption);
            }
        });

        socket.on('signatureRequest', async (data) => {
            // if not leader, ignore
            try{
            if(this.peers[index].state !== NodeStatus.Leader || this.peers[this.Iam].state !== NodeStatus.Follower) return;
          
                switch (data.type) {
                    case "rejection":
                        await ADAWatcher.signReject(data);
                        break;
                    case "mint":
                        await ADAWatcher.signMint(data);
                        break;
                    case "confescation":
                        await ADAWatcher.signConfescation(data);
                        break;
                
                    default:
                        console.log("Unknown Signature Request");
                }    
            }catch(err){
                console.log("Error signing transaction", err);
            }
            
        });

        socket.on('btcSignatureRequest', async (tx: { tx : string , type: string  }) => {
            // if not leader, ignore
            if(this.peers[index].state !== NodeStatus.Leader || this.peers[this.Iam].state !== NodeStatus.Follower) return;
            try{
                switch (tx.type) {
                    case "consolidation":
                        console.log("signing consolidation transaction outer: ",tx);
                        const signature = BTCWatcher.signConsolidationTransaction(tx.tx);
                        console.log("seding signature", signature);
                        this.peers[this.getLeader()].outgoingConnection.emit('btcSignatureResponse', signature);
                        break;
      
                    }
            }catch(err){
                console.log("Error signing transaction", err);
            }

        });

        socket.on('btcSignatureResponse', async (data) => {

            // if not leader, ignore
            if(this.peers[this.Iam].state !== NodeStatus.Leader) return;
            this.btcTransactionsBuffer.forEach((tx) => {
                try{
                    tx.tx = BTCWatcher.combine(tx.tx,data)
                    if(tx.tx.data.inputs[0].partialSig.length >= this.topology.m){
                        tx.status = "completed";
                        BTCWatcher.completeAndSubmit(tx.tx).then((txId) => {
                                console.log("Transaction completed and submitted", txId , tx.type);   
                           }).catch((err) => {
                               console.log("Error completing and submitting transaction", err);
                           });
                    }
                }catch(err){
                    console.log("Signature processing error:", err);
                }

            });
        });

        socket.on("updateRedemptionId", async (data) => {
            if(this.peers[this.Iam].state !== NodeStatus.Leader) return;
            coordinator.updateRedemptionId(data);
        });

        socket.on('burnSignature' , async (signature) => {
            // if not leader, ignore
            try{
            console.log("Burn signature received", signature, "from", this.peers[index].id)
            if(this.peers[this.Iam].state !== NodeStatus.Leader) return;
            const burnTx =  ADAWatcher.txCompleteFromString(coordinator.getBurnTx());     
            const signatureInfo = ADAWatcher.decodeSignature(signature);
            if (!signatureInfo.witness.vkeys().get(0).vkey().public_key().verify( Buffer.from(burnTx.toHash(), 'hex'), signatureInfo.witness.vkeys().get(0).signature())){
                console.log("Invalid signature");
                return;
            }
            coordinator.newBurnSignature(signature);
            }catch(err){
                console.log("Error importing burn-transaction signature", err);
            }
        });

        socket.on('newRedemSignature', async (signature) => {
            // if not leader, ignore
            if(this.peers[this.Iam].state !== NodeStatus.Leader) return;
            coordinator.newRedemptionSignature(signature);
        });


        socket.on('signatureResponse',async (data) => {
            // if not leader, ignore
            if(this.peers[this.Iam].state !== NodeStatus.Leader) return;

            const pendingTx = this.transactionsBuffer.find((tx) => tx.txId === data.txId);
            const signatureInfo = ADAWatcher.decodeSignature(data.signature);
            if (!signatureInfo.witness.vkeys().get(0).vkey().public_key().verify( Buffer.from(pendingTx.tx.toHash(), 'hex'), signatureInfo.witness.vkeys().get(0).signature())){
                console.log("Invalid signature");
                return;
            }
            if(!pendingTx.signatures.includes(data.signature.toString()))
                pendingTx.signatures.push(data.signature.toString());
            if(pendingTx.signatures.length >= this.topology.m){
                const completedTx = (await pendingTx.tx.assemble(pendingTx.signatures).complete())
                ADAWatcher.submitTransaction(completedTx);
                pendingTx.status = "completed";
            }
        });

        socket.on('newRedemption', async (data: redemptionController ) => {
            // if peer is not leader, ignore
            if(this.peers[index].state !== NodeStatus.Leader ) return;
            coordinator.importRedemption(data);
            
        });
        
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

    private gatherSignatures(){
        //if not leader, ignore
        if(this.peers[this.Iam].state !== NodeStatus.Leader) return;

        this.peers.forEach((node, index) => {
            this.transactionsBuffer.forEach((tx) => {
                const [decodedTx , _ ] = ADAWatcher.decodeTransaction(tx.tx)

                if(node.state === NodeStatus.Follower && node.outgoingConnection && decodedTx.required_signers.some((signature : string) => signature === node.keyHash) && tx.status === "pending"){
                    node.outgoingConnection.emit('signatureRequest', {type: tx.type , txId: tx.txId, signature: tx.signatures[0], tx: tx.tx.toString(), metadata: tx.metadata});
                }
            });

            this.btcTransactionsBuffer.forEach((tx) => {
                if(node.state === NodeStatus.Follower && node.outgoingConnection && tx.status === "pending"){
                    node.outgoingConnection.emit('btcSignatureRequest', { tx : tx.tx.toHex(), type: tx.type});
                }
            });
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
    leaderBroadcast(method, params= undefined) {
        try{
            this.peers[this.getLeader()].outgoingConnection.emit(method, params);
        }catch(err){
            console.log("Error sending to leader", err);
        }
    }


    broadcast(method, params= undefined) {
        this.peers.forEach((node, index) => {
            if (node.outgoingConnection && index !== this.Iam) {
                node.outgoingConnection.emit(method, params);
            }
        });
    }

    sendToLeader(method, params= undefined) {
        try{
            this.peers[this.getLeader()].outgoingConnection.emit(method, params);
        }catch(err){
            console.log("Error sending to leader", err);
        }
    }
}
