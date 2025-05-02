#!/usr/bin/env node

import { execSync } from 'child_process';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const NETWORKS = {
    'mainnet': 'https://cardano-mainnet.blockfrost.io',
    'preview': 'https://cardano-preview.blockfrost.io',
    'preprod': 'https://cardano-preprod.blockfrost.io'
};

async function main() {
    console.log('Welcome to AnetaV2 Setup and Management Tool\n');
    
    while (true) {
        console.log('\nAvailable commands:');
        console.log('1. Install dependencies');
        console.log('2. Generate guardian angel');
        console.log('3. Regenerate guardian angel');
        console.log('4. Create BTC transaction');
        console.log('5. Create ADA transaction');
        console.log('6. Inspect BTC transaction');
        console.log('7. Inspect ADA transaction');
        console.log('8. Exit');
        
        const choice = await askQuestion('\nEnter your choice (1-8): ');
        
        switch (choice) {
            case '1':
                await installDependencies();
                break;
            case '2':
                await generateGuardianAngel();
                break;
            case '3':
                await regenerateGuardianAngel();
                break;
            case '4':
                await createBTCTransaction();
                break;
            case '5':
                await createADATransaction();
                break;
            case '6':
                await inspectBTCTransaction();
                break;
            case '7':
                await inspectADATransaction();
                break;
            case '8':
                console.log('Goodbye!');
                process.exit(0);
            default:
                console.log('Invalid choice. Please try again.');
        }

        const continueChoice = await askQuestion('\nDo you want to continue? (y/n): ');
        if (continueChoice.toLowerCase() !== 'y') {
            console.log('Goodbye!');
            process.exit(0);
        }
    }
}

async function installDependencies() {
    console.log('\nInstalling dependencies...');
    try {
        execSync('npm install', { stdio: 'inherit' });
        console.log('Dependencies installed successfully!');
    } catch (error) {
        console.error('Error installing dependencies:', error.message);
    }
}

async function generateGuardianAngel() {
    console.log('\nGenerating guardian angel...');
    try {
        execSync('node generateGuardianAngel.js', { stdio: 'inherit' });
    } catch (error) {
        console.error('Error generating guardian angel:', error.message);
    }
}

async function regenerateGuardianAngel() {
    console.log('\nRegenerating guardian angel...');
    try {
        const seed = await askQuestion('Enter your seed phrase: ');
        execSync(`node seedToAngelListing.js  "${seed}"`, { stdio: 'inherit' });
    } catch (error) {
        console.error('Error regenerating guardian angel:', error.message);
    }
}

async function createBTCTransaction() {
    console.log('\nCreating BTC transaction...');
    try {
        const amount = await askQuestion('Enter amount in BTC: ');
        const address = await askQuestion('Enter recipient address: ');
        execSync(`node createBTCTransaction.js --amount ${amount} --address ${address}`, { stdio: 'inherit' });
    } catch (error) {
        console.error('Error creating BTC transaction:', error.message);
    }
}

async function createADATransaction() {
    console.log('\nCreating ADA transaction...');
    try {
        const amount = await askQuestion('Enter amount in ADA: ');
        const address = await askQuestion('Enter recipient address: ');
        execSync(`node createADATransaction.js --amount ${amount} --address ${address}`, { stdio: 'inherit' });
    } catch (error) {
        console.error('Error creating ADA transaction:', error.message);
    }
}

async function inspectBTCTransaction() {
    console.log('\nInspecting BTC transaction...');
    try {
        const txId = await askQuestion('Enter transaction ID: ');
        execSync(`node inspectBTCTransaction.js --txId ${txId}`, { stdio: 'inherit' });
    } catch (error) {
        console.error('Error inspecting BTC transaction:', error.message);
    }
}

async function inspectADATransaction() {
    console.log('\nInspecting ADA transaction...');
    try {
        const txId = await askQuestion('Enter transaction ID: ');
        execSync(`node inspectADATransaction.js --txId ${txId}`, { stdio: 'inherit' });
    } catch (error) {
        console.error('Error inspecting ADA transaction:', error.message);
    }
}

function askQuestion(query) {
    return new Promise((resolve) => {
        rl.question(query, (answer) => {
            resolve(answer);
        });
    });
}

main().catch(console.error); 