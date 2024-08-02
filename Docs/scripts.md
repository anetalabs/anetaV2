## Setup 
Before running any of the scripts, you need to install the dependencies. 
```bash
npm install
```

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

