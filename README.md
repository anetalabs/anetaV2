# AnetaV2 Guardian Angel implemetation


AnetaBTC V2 protocol - secure, decentralized, user-friendly. 

## Overview

The AnetaBTC V2 protocol is a destributed protocol that allows users to securely store and transfer their bitcoin on to the Cardano blockchain. Each the Guardian angels comunicate with each other and coordinate the transfer of the bitcoin from one blockchain to the other. To complete any transaction, M-of-N guardian angels must agree on the transaction making guardian angels the guardians and custodians of the bridge. 

For an overview of the protocol, please refer to the TODO.

For a list of the API endpoints, please refer to the [API](Docs/api.md) documentation.

For instructions on how to use the manual scripts, please refer to the [scripts](Docs/scripts.md) documentation.


## Instructions: 

To start the software Install dokcer and docker-compose on your machine.
```bash
sudo apt update
sudo apt install apt-transport-https ca-certificates curl software-properties-common
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu focal stable"
apt-cache policy docker-ce
sudo apt install docker-ce
```


To bootstrap the dolos node using mithril, run the following command: [Important during first start]
```bash
docker run -it   -p 50051:50051   -v "$(pwd)/config/dolos.toml:/etc/dolos/daemon.toml"   -v "$(pwd)/dolos/<<TARGET_NETWORK>>/genesis:/etc/dolos/genesis"   -v "$(pwd)/../data/dolos:/data"   --entrypoint sh   ghcr.io/txpipe/dolos:v0.20.0   -c " dolos bootstrap "
```

Create configuration from example files
```bash
mkdir config
cp configExamples/<<TARGET_NETWORK>>/* config
```

Copy the genesis files into the config folder

```bash
mkdir config/genesis
cp -r dolos/<<TARGET_NETWORK>>/genesis config/genesis
```

If running on mainnet make sure to update the cardano config and point to a node you own, you do that by editing the dolos.toml
`peer_address = "5.250.178.133:4000"` -> `peer_address = <<Your own relay IP:port>>` 


To start a guardian angel
```bash
docker compose up -d
```

The guardian angel will start in the preview testnet for Cardano and on the Testnet3 for Bitcoin, if you start the node with the included configuration it will try to start bootstraping immidietly. 

## Configuration

The config files for the docker deployment can be found under the `config` folder, for the protocol to function properly the `protocol.json` and `topology.json` should be identical for all the Guardian angels running the bridge! 

The other config files ajust the way the guardian angel interacts with the blockchain, the `bitcoin.conf` and `cardano.conf` files are the configuration files for the bitcoin and cardano nodes respectively. 

The `secrets` file is intended to store the private keys for the guardian angel, it should be kept secret and not shared with anyone. 

<!-- create a link to the Docs/scripts.md file  -->

## Documentation


For more information on the guardian angel and the protocol, please refer to the [Protocol](Docs/protocol.md) documentation




For more information, go to our website https://anetabtc.io. 

