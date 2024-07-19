## API 

The Guardian Angel software is equipped with an API that allows you to query the status of the vault and the transactions that have been made.

By default, the API is exposed on port 3030 but this can be changed py passing the parameter `--apiPort <PORT>` to the guardian angel during startup.    
### Endpoints: 

#### `/`

Returns the address for the bridge and for the Guardian angel, Guardian angels should have 5ADA in their address to be able and set collateral. 

#### `/redemptionReqests`

Gets the open redemption requests.

#### `/redemptionState`

Returns the state of the latest redemption beeing processest .

#### `/status`

Returns the high level status of the system and the network.

#### `/paymentPaths`

Returns the status for all the avaiable payment paymentPaths.

####   `/paymentPaths/:index

Returns the status of a specific payment paymentPath.

#### `/utxos`

Returns a list of lists for all the address controlled by the bridge, the last entrie is the vault.

#### `/utxos/:index`

Returns the UTxOs of the address corresponing to the payment path provided. 


#### `/vault`

Returns a list of Utxos that are controlled by the BTC vault.

#### `/networkStatus`

Returns the networking status.

#### `/requests`

Returns a list of all requests currently open. 