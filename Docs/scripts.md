## Setup 
Before running any of the scripts, you need to install Node.js (version 16 or higher recommended) on your system. You can download it from [nodejs.org](https://nodejs.org/).

All scripts are managed through the master.js interface. To start the interface, run:
```bash
node master.js
```

The master interface provides the following options:

### 1. Install dependencies
This option will install all required npm packages for the scripts. This is the first step you should take after installing Node.js.

### 2. Generate guardian angel
Creates a new Guardian angel key and topology entry.

### 3. Regenerate guardian angel
Recreates your topology entry from a seed phrase.

### 4. BTC Transaction Menu
Provides the following options:
- Create new vault transfer transaction
  - Specify amount (0 for entire balance)
  - Specify target address
- Inspect transaction
  - Enter transaction hex to view details
- Sign transaction
  - Enter transaction hex to sign
- Submit transaction
  - Enter signed transactions hex to submit (comma-separated)

### 5. ADA Transaction Menu
Provides the following options:
- Create new config transaction
  - Enter current signers (comma-separated)
  - Enter new members (comma-separated)
  - Enter new M value
- Inspect transaction
  - Enter transaction hex to view details
- Sign transaction
  - Enter transaction hex to sign
- Complete and submit transaction
  - Enter transaction hex
  - Enter signatures (comma-separated)

### 6. Exit
Exits the master interface.

The master interface will prompt you for any required information and handle the execution of the appropriate scripts automatically. This provides a more user-friendly way to interact with the various scripts compared to running them individually.

All the following commands should be run from the `scripts` folder.
```bash
cd scripts
```

### To create a new Guardian angel key and topology entry, run the following command: 
```bash
 node .\generateGuardianAngel.js
```

### To Recreate your topology entry from a seed phrase: 

```bash 
node .\seedToAngelListing.js "creek ... soul"
```

All the following commands should be run from the `scripts/migration/Bitcoin` folder.
```bash
cd scripts/migration/Bitcoin
```

### To create a BTC transaction from the vault: 

```bash
node .\newBtcVaultTx.js  --targetAddress tb1q0sn30stpdm4uk392fxwt3ykx6jedwq3207wq8v  --amount 0.01
```

You can leave the `--amount` flag empty to send the entire balance of the vault.

### To inspect a BTC transaction: 

```bash
node .\inspectTx.js --txHex <HexEncodedTxString>
```

### To sign a BTC transaction: 

```bash
node .\signBtcTx.js --txHex <HexEncodedTxString>
```

### To Merge multiple signed transactions and submit them to the network: 

```bash
node .\combineAndSubmit.js  --txHex  <HexEncodedTxString1>  --txHex  <|HexEncodedTxString2>  --txHex  <|HexEncodedTxString3> 
```

All the following commands should be run from the `scripts/migration/Cardano` folder.
```bash
cd scripts/migration/Cardano
```

### To create a new Cardano transaction that updates the guardian angel set:

```bash
node .\createConfigChangeTx.js --signers <[HexEncodedKey1, HexEncodedKey2, ...]> --newMembers  <[HexEncodedKey1, HexEncodedKey2, ...]> --newM  <Number> 
```

### To inspect a Cardano transaction:

```bash
node .\inspectTx.js --txHex <HexEncodedTxString>
```

### To sign a Cardano transaction:

## Troubleshooting

### Common Issues and Solutions

#### 1. Dependency Installation Issues
- **Error**: `Error installing dependencies`
  - **Solution**: Ensure you have Node.js installed (version 16 or higher recommended)
  - **Solution**: Try running `npm install` manually from the scripts directory
  - **Solution**: If using Windows, run PowerShell as administrator

#### 2. Guardian Angel Generation Issues
- **Error**: `Error generating guardian angel`
  - **Solution**: Ensure you have write permissions in the config directory
  - **Solution**: Check if the config files exist in the correct location
  - **Solution**: Verify network connectivity for seed generation

#### 3. BTC Transaction Issues
- **Error**: `No UTXOs to redeem`
  - **Solution**: Verify the vault address has sufficient funds
  - **Solution**: Check if you're using the correct network (testnet/mainnet)
  - **Solution**: Ensure the topology file contains valid guardian keys

- **Error**: `Target address is required`
  - **Solution**: Always provide a valid Bitcoin address when creating transactions
  - **Solution**: Verify the address format matches the network (testnet/mainnet)

#### 4. ADA Transaction Issues
- **Error**: `Error handling ADA transaction`
  - **Solution**: Verify your Blockfrost API key in scriptsConfig.json
  - **Solution**: Check network connectivity to Blockfrost
  - **Solution**: Ensure you have sufficient ADA for transaction fees

#### 5. Configuration Issues
- **Error**: `Cannot read property of undefined`
  - **Solution**: Verify all required config files exist:
    - `config/cardanoConfig.json`
    - `config/bitcoinConfig.json`
    - `config/topology.json`
    - `config/secrets.json`
  - **Solution**: Check file permissions and JSON format

#### 6. Transaction Signing Issues
- **Error**: `Invalid transaction hex`
  - **Solution**: Ensure the transaction hex is complete and properly formatted
  - **Solution**: Verify you're using the correct signing key
  - **Solution**: Check if the transaction hasn't expired

### Best Practices
1. Always backup your seed phrases and private keys
2. Test transactions with small amounts first
3. Keep your config files secure and never share them
4. Regularly update dependencies to the latest compatible versions
5. Monitor transaction fees before submitting transactions

### Getting Help
If you encounter issues not covered in this troubleshooting guide:
1. Check the error message carefully for specific details
2. Verify all configuration files are properly set up
3. Ensure you're using the latest version of the scripts
4. Contact the development team with:
   - The exact error message
   - Steps to reproduce the issue
   - Relevant configuration details (without sensitive information)


