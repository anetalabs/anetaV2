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
        console.log('4. BTC Transaction Menu');
        console.log('5. ADA Transaction Menu');
        console.log('6. Exit');
        
        const choice = await askQuestion('\nEnter your choice (1-6): ');
        
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
                await handleBTCTransaction();
                break;
            case '5':
                await handleADATransaction();
                break;
            case '6':
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

async function handleBTCTransaction() {
    console.log('\nBTC Transaction Menu:');
    console.log('1. Create new vault transfer transaction');
    console.log('2. Inspect transaction');
    console.log('3. Sign transaction');
    console.log('4. Submit transaction');
    
    const choice = await askQuestion('\nEnter your choice (1-3): ');
    
    try {
        switch (choice) {
            case '1':
                const amount = await askQuestion('Enter amount in BTC(0 for all): ');
                const address = await askQuestion('Enter recipient address: ');
                if (amount !== '0') {
                    execSync(`node migration/Bitcoin/newBtcVaultTx.js  --amount ${amount} --targetAddress ${address}`, { stdio: 'inherit' });
                } else {
                    execSync(`node migration/Bitcoin/newBtcVaultTx.js  --targetAddress ${address}`, { stdio: 'inherit' });
                }
                break;
            case '2':
                const txId = await askQuestion('Enter transaction hex to inspect: ');
                execSync(`node migration/Bitcoin/inspectTx.js --txHex ${txId}`, { stdio: 'inherit' });
                break;
            case '3':
                const txToSign = await askQuestion('Enter transaction hex to sign: ');
                execSync(`node migration/Bitcoin/signBtcTx.js --txHex ${txToSign}`, { stdio: 'inherit' });
                break;
            case '4':
                const txToSubmit = await askQuestion('Enter signed transactions hex to submit (comma-separated): ');
                const txArray = txToSubmit.split(',').map(tx => `--txHex ${tx.trim()}`);
                const txString = txArray.join(' ');
                execSync(`node migration/Bitcoin/combineAndSubmit.js ${txString}`, { stdio: 'inherit' });
                break;
            default:
                console.log('Invalid choice. Please try again.');
        }
    } catch (error) {
        console.error('Error handling BTC transaction:', error.message);
    }
}

async function handleADATransaction() {
    console.log('\nADA Transaction Menu:');
    console.log('1. Create new config transaction');
    console.log('2. Create new mint transaction');
    console.log('3. Inspect transaction');
    console.log('4. Sign transaction');
    console.log('5. Complete and submit transaction');
    
    const choice = await askQuestion('\nEnter your choice (1-5): ');
    
    try {
        switch (choice) {
            case '1':
                const signers = await askQuestion('Enter current signers (comma-separated): ');
                const newMembers = await askQuestion('Enter new members (comma-separated): ');
                const newM = await askQuestion('Enter new M value: ');
                execSync(`node migration/Cardano/createConfigChangeTx.js --signers "[${signers}]" --newMembers "[${newMembers}]" --newM ${newM}`, { stdio: 'inherit' });
                break;
            case '2':
                const mintSigners = await askQuestion('Enter current mint signers (comma-separated): ');
                const amount = await askQuestion('Enter amount: ');
                const metadata = await askQuestion('Enter metadata (empty for none): ');
                const metadataArg = metadata ? `--metadata "${metadata.replace(/"/g, '\\"')}"` : '';
                execSync(`node createMintTx.js --amount ${amount} --signers "[${mintSigners}]" ${metadataArg}`, { stdio: 'inherit' });
                break;
            case '3':
                const txToInspect = await askQuestion('Enter transaction hex to inspect: ');
                execSync(`node migration/Cardano/inspectTx.js --txHex ${txToInspect}`, { stdio: 'inherit' });
                break;
            case '4':
                const txToSign = await askQuestion('Enter transaction hex to sign: ');
                execSync(`node migration/Cardano/signTx.js --txHex ${txToSign}`, { stdio: 'inherit' });
                break;
            case '5':
                const txToSubmit = await askQuestion('Enter transaction hex to submit: ');
                const signatures = await askQuestion('Enter signatures (comma-separated): ');
                const signatureArray = signatures.split(',').map(signature => `--signature ${signature.trim()}`);
                const signatureString = signatureArray.join(' ');
                execSync(`node migration/Cardano/completeAndSubmit.js --txHex ${txToSubmit} ${signatureString}`, { stdio: 'inherit' });
                break;
            default:
                console.log('Invalid choice. Please try again.');
        }
    } catch (error) {
        console.error('Error handling ADA transaction:', error.message);
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