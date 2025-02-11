import { ADAWatcher, BTCWatcher, coordinator, notification } from './index.js';
import { topology, secretsConfig, pendingCardanoTransaction, pendingBitcoinTransaction, NodeStatus, redemptionController , redemptionState , cardanoConfig} from './types.js';
import { Server, Socket as ServerSocket } from 'socket.io';
import { Socket as ClientSocket } from 'socket.io-client';
import  Client  from 'socket.io-client';
//import * as Lucid  from 'lucid-cardano';
import * as LucidEvolution from '@lucid-evolution/lucid';

import { CardanoWatcher } from './cardano.js';
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
    penaltyTime: Date | null;
}

interface SignatureRequestData {
    type: 'rejection' | 'mint' | 'confescation';
    txId: string;
    signature: string;
    tx: string;
    metadata?: any;
}

interface BtcSignatureRequestData {
    tx: string;
    type: 'consolidation';
}

class InputValidator {
    static readonly VALID_NODE_STATES = [NodeStatus.Leader, NodeStatus.Follower, NodeStatus.Learner, NodeStatus.Monitor, NodeStatus.Candidate, NodeStatus.Disconnected];
    static readonly MAX_STRING_LENGTH = 10000; // Adjust based on your needs
    
    static isValidSignatureResponse(data: { txId: string; signature: string; }) {
        if(!data || typeof data !== 'object') return false;
        const reqData = data as {txId: string, signature: string};
        if(!this.isValidString(reqData.txId)) return false;
        if(!this.isValidString(reqData.signature)) return false;
        return true;
    }
    static isValidUpdateRedemptionToComplete(data: {tx : string}) {
        if(!data || typeof data !== 'object') return false;
        const reqData = data as {tx : string};
        if(!this.isValidString(reqData.tx)) return false;

        return true;
    }
    
    static isValidRedemption(data: redemptionController) {
        if(!data || typeof data !== 'object') return false;
        const reqData = data as redemptionController;
        if(!this.isValidString(reqData.currentTransaction)) return false;
        if(!this.isValidString(reqData.burningTransaction.tx)) return false;
        if(!this.isValidString(reqData.burningTransaction.txId)) return false;
        if(!Array.isArray(reqData.burningTransaction.signatures)) return false;
        return true;
    }


    
    static isValidString(str: unknown): boolean {
        return typeof str === 'string' && str.length > 0 && str.length < this.MAX_STRING_LENGTH;
    }

    static isValidSignedMessage(data: unknown): data is LucidEvolution.SignedMessage {
        return typeof data === 'object' && data !== null && 'signature' in data && 'key' in data;
    }

    static isValidVote(data: unknown): data is { vote: string; signature: LucidEvolution.SignedMessage } {
        if (!data || typeof data !== 'object') return false;
        const voteData = data as { vote: string; signature: LucidEvolution.SignedMessage };
        
        if (!this.isValidString(voteData.vote) || !this.isValidSignedMessage(voteData.signature)) {
            return false;
        }

        try {
            const parsed = JSON.parse(voteData.vote as string);
            return (
                typeof parsed.candidate === 'number' &&
                typeof parsed.time === 'number' &&
                this.isValidString(parsed.voter)
            );
        } catch {
            console.log("Invalid vote data2", voteData);
            return false;
        }
    }

    static isValidSignatureRequest(data: unknown): data is SignatureRequestData {
        if (!data || typeof data !== 'object') return false;
        const reqData = data as SignatureRequestData;
        
        return (
            ['rejection', 'mint', 'confescation'].includes(reqData.type) &&
            this.isValidString(reqData.txId) &&
            this.isValidString(reqData.signature) &&
            this.isValidString(reqData.tx)
        );
    }

    static isValidBtcSignatureRequest(data: unknown): data is BtcSignatureRequestData {
        if (!data || typeof data !== 'object') return false;
        const reqData = data as BtcSignatureRequestData;
        
        return (
            reqData.type === 'consolidation' &&
            this.isValidString(reqData.tx)
        );
    }
}

export class Communicator {
    private peers: angelPeer[];
    private lucid: LucidEvolution.LucidEvolution;
    private address: string;
    private topology: topology;
    private leaderTimeout: Date;
    private cardanoNetwork: LucidEvolution.Network;
    private transactionsBuffer: pendingCardanoTransaction[] = [];
    private btcTransactionsBuffer: pendingBitcoinTransaction[] = [];
    private Iam: number;
    private networkStatus : {peers: any, leaderTimeout: number};
    private _connectingPeers: Set<number>;
    private signatureTimeouts: Map<string, { startTime: number, attempts: number }> = new Map();
    private static readonly SIGNATURE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    private static readonly BTC_SIGNATURE_TIMEOUT = 20 * 60 * 1000; // 20 minutes
    private static readonly PENALTY_TIMEOUT = 3 * 60 * 60 * 1000; // 3 hours
    private static readonly MAX_SIGNATURE_ATTEMPTS = 5;
    constructor(topology: topology, secrets: secretsConfig , port: number ) {
        this.heartbeat = this.heartbeat.bind(this);
        this.topology = topology;
        (async () => {           
                // sleep for 10 seconds
                await new Promise((resolve) => setTimeout(resolve, 10000));
                
                this.lucid = await ADAWatcher.newLucidInstance();
                this.cardanoNetwork = this.lucid.config().network;
                this.lucid.selectWallet.fromSeed(secrets.seed);
                const pubKey = LucidEvolution.getAddressDetails(await this.lucid.wallet().address()).paymentCredential.hash;
                //fing pubkey in topology or throw error

                const found = topology.topology.findIndex((node: { AdaPkHash: string }) => node.AdaPkHash === pubKey);
                console.log('Pubkey:', pubKey, found);
                if(found == -1){
                    throw new Error('Pubkey not found in topology');
                }

                this.Iam = found;
                this.address = LucidEvolution.credentialToAddress(this.cardanoNetwork,{type: "Key", hash: pubKey});
                this.peers = initializeNodes(topology, this.Iam, this.cardanoNetwork);
  
                while(!(ADAWatcher.inSync() && BTCWatcher.inSync())){
                    await new Promise((resolve) => setTimeout(resolve, 5000));
                    console.log(`Waiting for ${!ADAWatcher.inSync()? "Cardano-Watcher " : "" }${!BTCWatcher.inSync()? "Bitcoin-Watcher " : "" }sync`);
                }

                this.start(port);
                setInterval(this.heartbeat, HEARTBEAT);
                this.leaderTimeout = new Date();

                 
            
        })();
        
        function initializeNodes(topology: topology,  Iam: number, cardanoNetwork: LucidEvolution.Network) {
            return topology.topology.map((node, index) => {
                return {
                    id: node.name,
                    currentTerm: 0,
                    votedFor: null,
                    log: [],
                    connectionTime: undefined,
                    lastApplied: 0,
                    penaltyTime: null,
                    port: node.port,
                    ip: node.ip,
                    address: LucidEvolution.credentialToAddress(cardanoNetwork,{type: "Key", hash: node.AdaPkHash}) ,
                    keyHash: node.AdaPkHash, 
                    outgoingConnection: null,
                    incomingConnection: null,
                    state: index === Iam ? NodeStatus.Learner : NodeStatus.Disconnected
                };
            });
        }

        // Clean up on process exit
        process.on('SIGINT', () => {
            this.peers.forEach(peer => {
                if (peer.outgoingConnection) {
                    peer.outgoingConnection.disconnect();
                }
                if (peer.incomingConnection) {
                    peer.incomingConnection.disconnect();
                }
            });
            process.exit();
        });

        this._connectingPeers = new Set();
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
                    this.queryMissingData();
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
            peer.outgoingConnection.emit('vote', {vote: JSON.stringify(vote), signature: await this.lucid.wallet().signMessage(this.peers[this.Iam].address, this.stringToHex(JSON.stringify(vote)))});
        }else {
            this.peers.forEach(async (node : angelPeer) => {
                if (node.outgoingConnection) {
                    node.outgoingConnection.emit('vote', {vote: JSON.stringify(vote), signature: await this.lucid.wallet().signMessage(this.peers[this.Iam].address, this.stringToHex(JSON.stringify(vote)))});
                }
            
            });
        }
    }

    signatureResponse(data: {txId: string, signature: string}) {
       
            const leader = this.peers[this.getLeader()];
            if(leader && leader.outgoingConnection){
                leader.outgoingConnection.emit('signatureResponse', data);
            }
            
      
    }

   
    getQuorum() : string[]{
     // get the n nodes with the oldest connection time
    // / return  ["78e88e01d77184e41ba7ceb36af9fb6844640ba9ea968a1aa97c8d6e","a85265597b7023b0c56f550a688c16a1408d21d8154ae50ec94bd734"].map((pkHash) => this.lucid.utils.credentialToAddress({type: "Key", hash: pkHash})) 
      console.log("getting quorum", this.topology.m);
      const quorum = this.peers
            .filter((node) => node.state === NodeStatus.Follower)
            .sort((a, b) => a.connectionTime.getTime() - b.connectionTime.getTime())
            .slice(0, this.topology.m-1)
            .map((node) => node.address);
        quorum.push(this.address);
        return(quorum);
    }

    

    amILeader() : boolean {
        try{
            return this.peers[this.Iam].state === NodeStatus.Leader;
        }catch(e){
            console.log("Error in amILeader", e);
            return false;
        }   
    }

    async queryMissingData() {
       const foundRedemptions = await coordinator.getFoundRedemptions();
       const  foundRedemptionsRaw = foundRedemptions.map((redemption) => redemption.currentTransaction);

       foundRedemptionsRaw.forEach((redemption) => {
            this.sendToLeader("updateRequest", redemption);
       });
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
        
        this.clearInvalidTransactions();
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
            this.queryMissingData();
        }
        
        this.peers.forEach((node, index) => {
         
            if(node.penaltyTime && node.penaltyTime < new Date()){
                 node.penaltyTime = null;
            }
            if(node.outgoingConnection === null && node.penaltyTime === null){
                if(index !== this.Iam )   this.connect(index);
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
        if(this.peers[this.Iam].state === NodeStatus.Learner && this.countVotes() !== null){
            this.peers[this.Iam].state = NodeStatus.Follower;
            this.broadcast('statusUpdate', NodeStatus.Follower);
        }
        this.networkStatus = {peers: peerStatus, leaderTimeout : new Date(this.leaderTimeout).getTime() - new Date().getTime() };
    }

    public getNetworkStatus(){
        return this.networkStatus;
    }

    private clearInvalidTransactions() {
        this.transactionsBuffer = this.transactionsBuffer.filter((tx) => ADAWatcher.checkTransaction(tx.tx.toCBOR({canonical : true})));
        this.btcTransactionsBuffer = this.btcTransactionsBuffer.filter((tx) => BTCWatcher.checkTransaction(tx.tx));
    }

    private stringToHex(str: string) : string {
        return Buffer.from(str).toString('hex');
    }

    private handShake(socket: ServerSocket) : void{
        const timestamp = Date.now();
        const nonce = crypto.getRandomValues(new Uint8Array(32));
        const challenge = Buffer.concat([
            Buffer.from("challenge"),
            Buffer.from(timestamp.toString()),
            Buffer.from(nonce)
        ]).toString('hex');
    
        console.log("Starting handshake")
        const handshakeTimeout = setTimeout(() => {
            socket.disconnect();
            console.log("Handshake timeout");
        }, HEARTBEAT*5);
    
        socket.emit('challenge', challenge);

        socket.on('challengeResponse', async (response) => {
            const peerindex = this.peers.findIndex(peer => peer.address === response.address);
            clearTimeout(handshakeTimeout);
            if(this.peers[peerindex].penaltyTime && this.peers[peerindex].penaltyTime > new Date()){
                console.log("Peer is penalized", response.address);
                socket.disconnect();
                return;
            }
            console.log("Challenge response received")
            const addressHex =  LucidEvolution.CML.Address.from_bech32(response.address).to_hex()  //this.stringToHex(response.address);
            console.log("challenge response address", response, response.address);
            const verified = LucidEvolution.verifyData(addressHex , LucidEvolution.getAddressDetails(response.address).paymentCredential?.hash ,this.stringToHex(challenge), response);
            if(verified){
                if(peerindex === -1){
                    console.log("Peer not found", response.address);
                    socket.disconnect();
                    return;
                }
                this.applyRuntimeListeners(socket,peerindex);
                this.peers[peerindex].incomingConnection = socket;
                this.peers[peerindex].connectionTime = new Date();
                console.log("Authentication successful for", response.address, ", peer:", peerindex);
                socket.emit('authenticationAccepted');
                
            }else{
                socket.disconnect();
                console.log("Authentication failed for", response.address , "disconnecting...")
            }
            }
        );
    }


    private countVotes() {
        if (this.peers[this.Iam].state === NodeStatus.Learner) {
            let votes = this.peers.map((node) => node.votedFor);
            let max = 0;
            let candidate = null;
            votes.forEach((vote) => {
                if (votes.filter((v) => v === vote).length > max) {
                    max = votes.filter((v) => v === vote).length;
                    candidate = vote;
                }
            });
            if (max >= this.topology.m  || 
                (this.peers[this.Iam].votedFor !== candidate) && max >= this.topology.m - 1) {
                return candidate;
            }
        }


        for(let i = 0; i < this.peers.length; i++){
          if( this.peers.filter((node) => node.votedFor === i).length >= this.topology.m){
           return i;
          }

        }

        return null;
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

    private getActiveLeader() : number{
        return this.peers.findIndex((node) => node.state === NodeStatus.Leader);
    }
    
    private applyRuntimeListeners(socket: ServerSocket, index: number) {
        
        // socket.removeAllListeners();
        socket.on('heartbeat', () => {  
         //   console.log('Received incoming heartbeat from', this.peers[index].id);
            if(this.peers[index].state === NodeStatus.Leader){
                this.leaderTimeout =  new Date();
            }
        });



        socket.on('statusUpdate', (status) => {
            if(status == this.peers[index].state) return;
            if (!this.validateStateTransition(this.peers[index].state, status)) {
                console.log('Invalid state transition attempted:', {
                    from: this.peers[index].state,
                    to: status,
                    peer: this.peers[index].id
                });
                return;
            }
            this.peers[index].state = status;
        });

        socket.on('vote', (vote : {vote : string, signature : string}) => {   
            try {
                if (!InputValidator.isValidVote(vote)) {
                    console.log('Invalid vote data received');
                    return;
                }
                
                const decodedVote: vote = JSON.parse(vote.vote);
                const addressHex = LucidEvolution.CML.Address.from_bech32(decodedVote.voter).to_hex();
                const verified = LucidEvolution.verifyData(
                    addressHex,
                    LucidEvolution.getAddressDetails(decodedVote.voter).paymentCredential?.hash,
                    this.stringToHex(vote.vote),
                    vote.signature
                );
                
                const addressIsPeer = (this.peers.findIndex(peer => peer.address === decodedVote.voter) === index);
                const isTimeValid = Math.abs(decodedVote.time - Date.now()) < HEARTBEAT;
                
                if (verified && addressIsPeer && isTimeValid) {
                    console.log('Vote ', vote, 'accepted', decodedVote.candidate, 'from', decodedVote.voter);
                    this.peers[index].votedFor = decodedVote.candidate;
                } else {
                    console.log('Vote validation failed:', { verified, addressIsPeer, isTimeValid });
                }
            } catch (err) {
                console.error('Error processing vote:', err);
            }
        });        

        socket.on('voteRequest', () => {
            this.vote(this.getLeader(), this.peers[index]);
        });

        socket.on('queryRedemption', async () => {
            if(this.peers[index].state !== NodeStatus.Leader) return;
            const redemption = await coordinator.getCurrentRedemption();
            this.peers[index].outgoingConnection.emit('newRedemption', redemption[0]);
        });

        socket.on('signatureRequest', async (data : {type : string, txId: string, signature: string, tx: string, metadata: string}) => {
            try {
                if (!InputValidator.isValidSignatureRequest(data)) {
                    console.log('Invalid signature request data');
                    return;
                }

                if (this.peers[index].state !== NodeStatus.Leader || 
                    this.peers[this.Iam].state !== NodeStatus.Follower) {
                    return;
                }

                switch (data.type) {
                    case "rejection":
                        await ADAWatcher.signReject(data);
                        break;
                    case "mint":
                        if (!data.metadata) {
                            console.log('Missing required metadata for mint signature');
                            return;
                        }
                        
                        // Ensure data.metadata exists before calling signMint
                        if (data.metadata) {
                            await ADAWatcher.signMint({
                                ...data,
                                metadata: data.metadata
                            });
                        }
                        break;
                    case "confescation":
                        await ADAWatcher.signConfescation(data);
                        break;
                    default:
                        console.log("Unknown Signature Request Type");
                }    
            } catch (err) {
                console.error("Error processing signature request:", err);
            }
        });

        socket.on('btcSignatureRequest', async (data : {type : string, tx : string}) => {
            try {
                if (!InputValidator.isValidBtcSignatureRequest(data)) {
                    console.log('Invalid BTC signature request data');
                    return;
                }

                if (this.peers[index].state !== NodeStatus.Leader || 
                    this.peers[this.Iam].state !== NodeStatus.Follower) {
                    return;
                }

                if (data.type === "consolidation") {
                    console.log("Signing consolidation transaction:", data);
                    const signature = BTCWatcher.signConsolidationTransaction(data.tx);
                    this.peers[this.getLeader()].outgoingConnection?.emit('btcSignatureResponse', signature);
                }
            } catch (err) {
                console.error("Error processing BTC signature request:", err);
            }
        });

        socket.on('btcSignatureResponse', async (data : string ) => {

            // if not leader, ignore
            if(this.peers[this.Iam].state !== NodeStatus.Leader) return;

            if (!InputValidator.isValidString(data)) {
                console.log('Invalid BTC signature response received');
                return;
            }

            this.btcTransactionsBuffer.forEach((tx) => {
                try{
                    if(BTCWatcher.txEqual(tx.tx.toHex(),data) && tx.tx.data.inputs[0].partialSig && tx.tx.data.inputs[0].partialSig.length < this.topology.m){
                        tx.tx = BTCWatcher.combine(tx.tx,data)
                        if(tx.tx.data.inputs[0].partialSig.length >= this.topology.m){
                            tx.status = "completed";
                        tx.tx.finalizeAllInputs();
                        BTCWatcher.completeAndSubmit(tx.tx).then((txId) => {
                                console.log("Transaction completed and submitted", txId , tx.type);   
                                this.transactionsBuffer = this.transactionsBuffer.filter(t => t.txId !== tx.tx.toHex());
                                this.signatureTimeouts.delete(`${tx.tx.toHex()}-${this.peers[index].keyHash}`);
                            }).catch((err) => {
                                console.log("Error completing and submitting transaction", err);
                            });
                        }
                    }
                }catch(err){
                    console.log("Signature processing error:", err);
                }

            });
        });

        socket.on("updateRedemptionToComplete", async (data : {tx : string}) => {
            if (!InputValidator.isValidUpdateRedemptionToComplete(data)) {
                console.log('Invalid update redemption to complete data');
                return;
            }
            console.log("Redemption to complete received", data);
            if(this.peers[index].state !== NodeStatus.Leader) return;
            coordinator.updateRedemptionToComplete(data);
        });

        socket.on('burnSignature' , async (signature : string) => {
            // if not leader, ignore
            try{
                if (!InputValidator.isValidString(signature)) {
                    console.log('Invalid burn signature data');
                    return;
                }
            console.log("Burn signature received", signature, "from", this.peers[index].id)
            if(this.peers[this.Iam].state !== NodeStatus.Leader) return;
            
             await coordinator.newBurnSignature(signature);
            }catch(err){
                console.log("Error importing burn-transaction signature", err);
                this.applyPunitveMeasures(this.peers[index], `Error importing burn-transaction signature: ${err}`);
            }
        });

        socket.on('newRedemSignature', async (data : {sig : string}) => {
            try{
            if (!InputValidator.isValidString(data.sig)) {
                console.log('Invalid new redemption signature data');
                this.applyPunitveMeasures(this.peers[index], `Invalid new redemption signature data: ${data.sig}`);
                return;
            }

            console.log("Redemption signature received", data, "from")
            if(this.peers[this.Iam].state !== NodeStatus.Leader) return;
            await coordinator.newRedemptionSignature(data.sig);
            }catch(err){
                console.log("Error importing new redemption signature", err);
                this.applyPunitveMeasures(this.peers[index], `Error importing new redemption signature: ${err}`);
            }
        });

        socket.on('signatureResponse',async (data : {txId: string, signature: string}) => {
            // if not leader, ignore
            if (!InputValidator.isValidSignatureResponse(data)) {
                console.log('Invalid signature response data');
                return;
            }


            if(this.peers[this.Iam].state !== NodeStatus.Leader) return;
            console.log("Signature response received", data);
            
            const pendingTx = this.transactionsBuffer.find((tx) => tx.txId === data.txId);
            const signatureInfo = ADAWatcher.decodeSignature(data.signature);
            if (!signatureInfo.witness.vkeywitnesses().get(0).vkey().verify( Buffer.from(pendingTx.tx.toHash(), 'hex'), signatureInfo.witness.vkeywitnesses().get(0).ed25519_signature())){
                this.applyPunitveMeasures(this.peers[index], `Invalid signature for Cardano transaction txId: ${data.txId}, type: ${pendingTx.type}`);
                console.log("Invalid signature");
                return;
            }
            if(!pendingTx.signatures.includes(data.signature.toString()))
                pendingTx.signatures.push(data.signature.toString());
            if(pendingTx.signatures.length >= this.topology.m){
                const completedTx = (await pendingTx.tx.assemble(pendingTx.signatures).complete())
                await ADAWatcher.submitTransaction(completedTx);
                pendingTx.status = "completed";
            }
        });

        socket.on('newRedemption', async (data: redemptionController ) => {
            if (!InputValidator.isValidRedemption(data)) {
                console.log('Invalid new redemption data');
                return;
            }
            // if peer is not leader, ignore
            console.log("New redemption received", data);
            if(this.peers[index].state !== NodeStatus.Leader ) return;
            coordinator.importRedemption(data);
            
        });

        socket.on('updateRequest', async (data : string) => {
            // if not leader, ignore
            if (!InputValidator.isValidString(data)) {
                console.log('Invalid update request data');
                return;
            }
            if(this.peers[this.Iam].state !== NodeStatus.Leader) return;
                
            const foundData = await  coordinator.getRedemptionState(data);
            if(foundData!== null){
                this.peers[index].outgoingConnection.emit('updateResponse', foundData);
            }

        });

        socket.on('updateResponse', async (data : redemptionController) => {
            // if message is not from leader, ignore
            if(this.peers[this.Iam].state !== NodeStatus.Follower) return;
            if (!InputValidator.isValidRedemption(data)) {
                console.log('Invalid update response data');
                return;
            }
            coordinator.completeFoundRedemption(data);
        });
     
        socket.on('disconnect', () => {
            console.log('Client disconnected', index,this.peers[index].id);
            
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
                const [decodedTx , _ ] = ADAWatcher.decodeTransaction(tx.tx.toCBOR({canonical : true}))

                if(node.state === NodeStatus.Follower && node.outgoingConnection && decodedTx.required_signers.some((signature : string) => signature === node.keyHash) && tx.status === "pending"){
                    // Track signature request
                    const sigKey = `${tx.txId}-${node.keyHash}`;
                    const timeoutInfo = this.signatureTimeouts.get(sigKey) || { startTime: Date.now(), attempts: 0 };
                    
                    // Check if we've been waiting too long for this signature
                    if (timeoutInfo.startTime + Communicator.SIGNATURE_TIMEOUT < Date.now()) {
                        console.log(`Signature timeout for node ${node.id} on tx ${tx.txId}`);
                        
                        // Increment attempts and reset timer
                        timeoutInfo.attempts++;
                        timeoutInfo.startTime = Date.now();
                        
                        if (timeoutInfo.attempts >= Communicator.MAX_SIGNATURE_ATTEMPTS) {
                            console.log(`Node ${node.id} failed to sign after ${Communicator.MAX_SIGNATURE_ATTEMPTS} attempts`);
                            // Remove the transaction from buffer
                            this.transactionsBuffer = this.transactionsBuffer.filter(t => t.txId !== tx.txId);
                            this.signatureTimeouts.delete(sigKey);
                            this.applyPunitveMeasures(node, `Cardano Signature timeout, txId: ${tx.txId}, type: ${tx.type}`);
                            return;
                        }
                    }
                    
                    // Update timeout tracking
                    this.signatureTimeouts.set(sigKey, timeoutInfo);
                    
                    // Request signature
                    node.outgoingConnection.emit('signatureRequest', {type: tx.type , txId: tx.txId, signature: tx.signatures[0], tx: tx.tx.toCBOR({canonical : true}), metadata: tx.metadata});
                }
            });

            this.btcTransactionsBuffer.forEach((tx) => {
                if(node.state === NodeStatus.Follower && node.outgoingConnection && tx.status === "pending"){
                    
                    node.outgoingConnection.emit('btcSignatureRequest', { tx : tx.tx.toHex(), type: tx.type});
                    
                }
            });
            // Request signature

        });
    }
  // Remove Cardano the transaction from buffer
  public removeCardanoTransaction(txId : string){
    this.transactionsBuffer = this.transactionsBuffer.filter(t => t.txId !== txId);
    this.signatureTimeouts.delete(`${txId}-${this.peers[this.Iam].keyHash}`);
  }

    public amI() : number {
        return this.Iam;
    }


    public checkAdaQuorum(pKHashes : string[] ) : boolean {
        console.log("Checking quorum", pKHashes)
        for(let i = 0; i < pKHashes.length; i++){
            const peer = this.peers.find((peer) => peer.keyHash === pKHashes[i]);
            
            if(peer === undefined){
                console.log("Peer not found", pKHashes[i]);
                return false;
            }
            if([NodeStatus.Follower , NodeStatus.Leader].includes(peer.state) === false){
                console.log("Peer not connected", pKHashes[i])
                return false;
            }
        }
        return true;
    }
        
    
    private applyPunitveMeasures(peer: angelPeer, reason : string) {
        console.error("ERROR: Penilizing peer", peer.id, "for", reason);
        peer.state = NodeStatus.Disconnected;
        peer.penaltyTime = new Date(Date.now() + Communicator.PENALTY_TIMEOUT);
        if (peer.incomingConnection) peer.incomingConnection.disconnect();
        if (peer.outgoingConnection) peer.outgoingConnection.disconnect();
        notification.notify(`Node ${peer.id} has been penilized for ${reason}`);
    }
    
    private async connect(i: number) {
        if (this._connectingPeers.has(i)) {
            console.log('Connection attempt already in progress');
            return;
        }

        // Add peer to connecting set
        this._connectingPeers.add(i);

        // Remove from connecting set after delay
        setTimeout(() => {
            this._connectingPeers.delete(i);
        }, 5000); // 5 second timeout

        if (this.peers[i].outgoingConnection) {
            console.log('Connection already exists');
            return;
        }

        const socket = Client(`http://${this.peers[i].ip}:${this.peers[i].port}`, { transports:  [ 'polling'] });
        this.peers[i].outgoingConnection = socket;

        socket.on('disconnect', () => {
            console.log('Disconnected from server', this.peers[i].id , i);
            this.peers[i].outgoingConnection = null;
            this.peers[i].state = NodeStatus.Disconnected;
            this._connectingPeers.delete(i);  // Clear connecting state
        });


        socket.on('connect_error', (error) => {
            socket.disconnect();
            console.log('Connect error', this.peers[i].id , i, error.message);
            this.peers[i].outgoingConnection = null;
            this.peers[i].state = NodeStatus.Disconnected;
            this._connectingPeers.delete(i);  // Clear connecting state
        });

        socket.on('connect_timeout', () => {
            console.log('Connection Timeout');
            socket.disconnect();
            this.peers[i].outgoingConnection = null;
            this.peers[i].state = NodeStatus.Disconnected;
            this._connectingPeers.delete(i);  // Clear connecting state
        });

        socket.on('challenge', async (challenge : string) => {
            if (!InputValidator.isValidString(challenge)) {
                console.log('Invalid challenge data');
                return;
            }
            console.log("Challenge received", challenge);
            const message : Object= await this.lucid.wallet().signMessage(this.address, this.stringToHex(challenge));
            message["address"] = this.address;
            socket.emit('challengeResponse', message);
        });

        socket.on('authenticationAccepted', () => {
            try{
                console.log('Authentication accepted');
                this.peers[i].outgoingConnection.emit("statusUpdate", this.peers[this.Iam].state);
            }catch(err){
                console.log("Error sending status update", err);
            }
        });
    }


    broadcast(method : string, params : any= undefined) {
        this.peers.forEach((node, index) => {
            if (node.outgoingConnection && index !== this.Iam) {
                node.outgoingConnection.emit(method, params);
            }
        });
    }

    sendToLeader(method : string, params : any= undefined) {
        try{
            if(this.getActiveLeader() === -1 || this.getActiveLeader() === this.Iam) return;
            this.peers[this.getActiveLeader()].outgoingConnection.emit(method, params);
        }catch(err){
            console.log("Error sending to leader", err);
        }
    }
    
    getBtcTransactionsBuffer(){
        return this.btcTransactionsBuffer;
    }

    getTransactionsBuffer(){
        return this.transactionsBuffer;
    }

    private validateStateTransition(currentState: NodeStatus, newState: NodeStatus): boolean {
        const validTransitions = {
            [NodeStatus.Disconnected]: [NodeStatus.Learner, NodeStatus.Follower , NodeStatus.Candidate],
            [NodeStatus.Learner]: [NodeStatus.Follower, NodeStatus.Candidate],
            [NodeStatus.Follower]: [NodeStatus.Candidate, NodeStatus.Disconnected],
            [NodeStatus.Candidate]: [NodeStatus.Leader, NodeStatus.Follower, NodeStatus.Disconnected],
            [NodeStatus.Leader]: [NodeStatus.Follower, NodeStatus.Disconnected],
            [NodeStatus.Monitor]: [NodeStatus.Follower, NodeStatus.Disconnected , NodeStatus.Candidate]
        };
    
        return validTransitions[currentState]?.includes(newState) || false;
    }
    
}
