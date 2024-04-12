// db.ts
import { MongoClient } from 'mongodb';

let client: MongoClient;

export async function connect(uri: string) {
    client = new MongoClient(uri);
    await client.connect();
}

export function getDb(databaseName: string) {
    return client.db(databaseName);
}



