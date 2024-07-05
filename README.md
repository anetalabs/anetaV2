# anetaV2
AnetaBTC V2 protocol - secure, decentralized, user-friendly. 

## Overview

The AnetaBTC V2 protocol is a destributed protocol that allows users to securely store and transfer their bitcoin on to the Cardano blockchain. Each the Guardian angels comunicate with each other and coordinate the transfer of the bitcoin from one blockchain to the other. To complete any transaction, M-of-N guardian angels must agree on the transaction making guardian angels the guardians and custodians of the bridge. 

For an overview of the protocol, please refer to the TODO.

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
docker run -it   -p 50051:50051   -v "$(pwd)/dolos/preview/preview.toml:/etc/dolos/daemon.toml"   -v "$(pwd)/dolos/preview/genesis:/etc/dolos/genesis"   -v "$(pwd)/../dolos/data:/data"   --entrypoint sh   ghcr.io/txpipe/dolos:latest   -c " dolos bootstrap "
```

To start a guardian angel
```bash
docker compose up -d
```

The guardian angel will start in the preview testnet for Cardano and on the Testnet3 for Bitcoin, if you start the node with the included configuration it will try to start bootstraping immidietly. 

## Configuration

The config files for the docker deployment can be found under the `config` folder, for the protocol to function properly the `protocol.json` and `topology.json` should be identical! 

The other config files ajust the way the guardian angel interacts with the blockchain, the `bitcoin.conf` and `cardano.conf` files are the configuration files for the bitcoin and cardano nodes respectively. 

The `secrets` file is intended to store the private keys for the guardian angel, it should be kept secret and not shared with anyone. 

<!-- create a link to the Docs/scripts.md file  -->

## Documentation


For more information on the guardian angel and the protocol, please refer to the TODO.




For more information, go to our website https://anetabtc.io. 
