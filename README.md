# anetaV2
AnetaBTC V2 protocol - secure, decentralized, user-friendly. 

Welcome to the beginning of the AnetaBTC V2 protocol. All code will be published in this Github organization. 

Track our developmnent journey as we look forward to deploying our V2 protocol on mainnnet. 


To bootstrap the dolos node using mithril, run the following command: 
`
docker run -it   -p 50051:50051   -v "$(pwd)/dolos/preview/preview.toml:/etc/dolos/daemon.toml"   -v "$(pwd)/dolos/preview/genesis:/etc/dolos/genesis"   -v "$(pwd)/../dolos/data:/data"   --entrypoint sh   ghcr.io/txpipe/dolos:latest   -c " dolos --config /etc/dolos/daemon.toml bootstrap "
`


For more information, go to our website https://anetabtc.io. 

