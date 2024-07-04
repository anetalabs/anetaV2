# anetaV2
AnetaBTC V2 protocol - secure, decentralized, user-friendly. 

Welcome to the beginning of the AnetaBTC V2 protocol. All code will be published in this Github organization. 

Track our developmnent journey as we look forward to deploying our V2 protocol on mainnnet. 

Install dokcer and docker-compose on your machine.
```bash
sudo apt update
sudo apt install apt-transport-https ca-certificates curl software-properties-common
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu focal stable"
apt-cache policy docker-ce
sudo apt install docker-ce
```

To bootstrap the dolos node using mithril, run the following command: 
`
docker run -it   -p 50051:50051   -v "$(pwd)/dolos/preview/preview.toml:/etc/dolos/daemon.toml"   -v "$(pwd)/dolos/preview/genesis:/etc/dolos/genesis"   -v "$(pwd)/../dolos/data:/data"   --entrypoint sh   ghcr.io/txpipe/dolos:latest   -c " dolos --config /etc/dolos/daemon.toml bootstrap "
`


For more information, go to our website https://anetabtc.io. 

