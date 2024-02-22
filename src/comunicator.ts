import { Server, Socket } from 'socket.io';
import { createServer } from 'http';



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
    server: Server;
}

class Raft {
    private nodes: Map<string, RaftNode>;
    private status: NodeStatus 

    constructor() {
        this.nodes = new Map();
        this.status = NodeStatus.Follower
    }

    addNode(id: string, port: number) {
     }

     getStatus(){
        return 
     }

    removeNode(id: string) {
        const node = this.nodes.get(id);
        if (node) {
            node.server.close();
            this.nodes.delete(id);
        }
    }

    handleRequestVote(socket: Socket, args: any) {
        // ... handle RequestVote RPC
    }

    handleAppendEntries(socket: Socket, args: any) {
        // ... handle AppendEntries RPC
    }

    // ... other methods for handling RPCs
}