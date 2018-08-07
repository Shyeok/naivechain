'use strict'; // 아래의 library 다운을 받아야함. 실행 및 확인은 postman를 통해서 진행
var CryptoJS = require("crypto-js"); // transaction 생성 및 varification 없음
var express = require("express");
var bodyParser = require('body-parser');
var WebSocket = require("ws");

var http_port = process.env.HTTP_PORT || 3001;
var p2p_port = process.env.P2P_PORT || 6001;
var initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];

class Block {

    constructor(index, previousHash, timestamp, data, hash, targetvalue) {

        this.index = index;
        this.previousHash = previousHash.toString();
        this.timestamp = timestamp;
        this.data = data;
        this.hash = hash.toString();
        this.nonce = 0;
        this.targetvalue = targetvalue;
        this.root = "";

        this.tx_set = [];
    }
}

class Merktle_Tree {

    constructor (){

        this.index = 0;
        this.node_values = [];
        this.root = "";

    }
}

var memory_pool = [{"sender" : "a","reciver" : "b","amount" : 100}, {"sender" : "b","reciver" : "c","amount" : 150}]; // memory_pool add

var sockets = [];

var MessageType = {

    QUERY_LATEST: 0,
    QUERY_ALL: 1,
    RESPONSE_BLOCKCHAIN: 2

};

var blockchain = [];

var mk_db = []; // 머클 트리 노드 값 저장

var initHttpServer = () => { // 통신 부분 중요함. 데이터는 json 형식에 의존함.
    var app = express(); // Http 통신
    app.use(bodyParser.json());

    app.get('/blocks', (req, res) => res.send(JSON.stringify(blockchain))); // show all blockchain

    app.post('/setGenesis', (req, res) => {  // gensis block setting
        
        var a = blockchain.length;
        console.log(JSON.stringify(a));
        if(a != 0) console.log("gensis block exists");
        else{
            var currentTimestamp = new Date().getTime() / 1000;
            
            var new_block = new Block(a, "0", 0, req.body.data, "", "0AAA");

            var blockHash = calculateHashForBlock(new_block);

            new_block.hash = blockHash.toString();
            
            blockchain.push(new_block);
        }
        res.send(JSON.stringify(blockchain)); 
    }); 

    app.post('/mineBlock', (req, res) => { // mining block

        var newBlock = generateNextBlock(req.body.data, memory_pool); // Using req.body.data for labeling block

        console.log(JSON.stringify(memory_pool));

        addBlock(newBlock);
        broadcast(responseLatestMsg());
        console.log('block added: ' + JSON.stringify(newBlock));
        res.send();

    });
    app.get('/peers', (req, res) => {
        res.send(sockets.map(s => s._socket.remoteAddress + ':' + s._socket.remotePort));
    });
    app.post('/addPeer', (req, res) => {
        connectToPeers([req.body.peer]);
        res.send();
    });
    app.listen(http_port, () => console.log('Listening http on port: ' + http_port));
};


var initP2PServer = () => { // Websocket
    var server = new WebSocket.Server({port: p2p_port});
    server.on('connection', ws => initConnection(ws));
    console.log('listening websocket p2p port on: ' + p2p_port);

};

var initConnection = (ws) => {// Websocket
    console.log('hello 3001111111111111111');
    sockets.push(ws);
    initMessageHandler(ws);
    initErrorHandler(ws);
    write(ws, queryChainLengthMsg());
};

var initMessageHandler = (ws) => {
    ws.on('message', (data) => {
        var message = JSON.parse(data);
        console.log('Received message' + JSON.stringify(message));
        switch (message.type) {
            case MessageType.QUERY_LATEST:
                write(ws, responseLatestMsg());
                break;
            case MessageType.QUERY_ALL:
                write(ws, responseChainMsg());
                break;
            case MessageType.RESPONSE_BLOCKCHAIN:
                handleBlockchainResponse(message);
                break;
        }
    });
};

var initErrorHandler = (ws) => {
    var closeConnection = (ws) => {
        console.log('connection failed to peer: ' + ws.url);
        sockets.splice(sockets.indexOf(ws), 1);
    };
    ws.on('close', () => closeConnection(ws));
    ws.on('error', () => closeConnection(ws));
};

// 블록 생성 부분 //
var generateNextBlock = (blockData, m_pool) => {

    m_pool.unshift({"sender" : "X", "reieciver" : "A", "amount" : 10}); // add coinbase

    var previousBlock = getLatestBlock();

    var nextIndex = previousBlock.index + 1;

    var nextTimestamp = new Date().getTime() / 1000;
    
    var nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimestamp, blockData);

    var new_block = new Block(nextIndex, previousBlock.hash, nextTimestamp, blockData, nextHash, "0AAA");

    var tx_n = 0; // The number of insert transaction

    var block_txs = []; // Insert transaction list

    while(tx_n <= 2 && m_pool.length != 0) { // assume block size is 3 transaction

        tx_n += 1;
        var new_tx = m_pool.shift();
        block_txs.push(new_tx);

    }


    new_block.tx_set = block_txs;

    makemerkletree(new_block, block_txs);

    ProofofWork(new_block);
    
   // console.log(JSON.stringify(memory_pool));

    return new_block;

};

var makemerkletree = (block, block_Transactions) => { // make merkle tree node's value

    var index_s = 0;
    var index_e = 0;
    var mk_vals = new Merktle_Tree();

    mk_vals.index = block.index;

    for( var i in block_Transactions){

        var tx_st = JSON.stringify(block_Transactions[i]);
        var h_val = CryptoJS.SHA256(tx_st).toString();
        mk_vals.node_values.push(h_val);

    }
    
    index_s = 0;
    index_e = mk_vals.node_values.length;

    while(index_s + 1 != index_e){

        for( var i = index_s; i < index_e; i=i+2){
            if(i + 1 < index_e){

                var h_val = CryptoJS.SHA256(mk_vals.node_values[i] + mk_vals.node_values[i+1]).toString();
                mk_vals.node_values.push(h_val);

            }
            else{

                var h_val = CryptoJS.SHA256(mk_vals.node_values[i]).toString();
                mk_vals.node_values.push(h_val);

            }
        }

        index_s = index_e;
        index_e = mk_vals.node_values.length;

    }

    block.root =  mk_vals.node_values[index_s];

    console.log(mk_vals.node_values);
}

var ProofofWork = (block) => { // Proof of Work 완료

    var h_val;
    while(1){

        h_val = CryptoJS.SHA256(block.root + (block.index).toString() + block.data + (block.nonce).toString()).toString();

        var res_val = h_val.substring(0,3);
        
        if(res_val < block.targetvalue) break;

        block.nonce += 1;

    }

}
var calculateHashForBlock = (block) => {

    return calculateHash(block.index, block.previousHash, block.timestamp, block.data);

};

var calculateHash = (index, previousHash, timestamp, data) => {

    return CryptoJS.SHA256(index + previousHash + timestamp + data).toString();

};

var addBlock = (newBlock) => {

    if (isValidNewBlock(newBlock, getLatestBlock())) {
        blockchain.push(newBlock);
    }

};

var isValidNewBlock = (newBlock, previousBlock) => { // Block transaction verification process X
    if (previousBlock.index + 1 !== newBlock.index) {
        console.log('invalid index');
        return false;
    } else if (previousBlock.hash !== newBlock.previousHash) {
        console.log('invalid previoushash');
        return false;
    } else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
        console.log(typeof (newBlock.hash) + ' ' + typeof calculateHashForBlock(newBlock));
        console.log('invalid hash: ' + calculateHashForBlock(newBlock) + ' ' + newBlock.hash);
        return false;
    }
    return true;
};

var connectToPeers = (newPeers) => {
    newPeers.forEach((peer) => {
        var ws = new WebSocket(peer);
        ws.on('open', () => initConnection(ws));
        ws.on('error', () => {
            console.log('connection failed')
        });
    });
};

var handleBlockchainResponse = (message) => { // event process
    var receivedBlocks = JSON.parse(message.data).sort((b1, b2) => (b1.index - b2.index));
    var latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];
    var latestBlockHeld = getLatestBlock();
    if (latestBlockReceived.index > latestBlockHeld.index) {
        console.log('blockchain possibly behind. We got: ' + latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index);
        if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
            console.log("We can append the received block to our chain");
            blockchain.push(latestBlockReceived);
            broadcast(responseLatestMsg());
        } else if (receivedBlocks.length === 1) {
            console.log("We have to query the chain from our peer");
            broadcast(queryAllMsg());
        } else {
            console.log("Received blockchain is longer than current blockchain");
            replaceChain(receivedBlocks);
        }
    } else {
        console.log('received blockchain is not longer than current blockchain. Do nothing');
    }
};

var replaceChain = (newBlocks) => { // Block reorganization, transaction verification X
    if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
        console.log('Received blockchain is valid. Replacing current blockchain with received blockchain');
        blockchain = newBlocks;
        broadcast(responseLatestMsg());
    } else {
        console.log('Received blockchain invalid');
    }
};

var isValidChain = (blockchainToValidate) => { // Optimazation
    if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(blockchain[0])) {
        return false;
    }
    var tempBlocks = [blockchainToValidate[0]];
    for (var i = 1; i < blockchainToValidate.length; i++) {
        if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
            tempBlocks.push(blockchainToValidate[i]);
        } else {
            return false;
        }
    }
    return true;
};

var getLatestBlock = () => blockchain[blockchain.length - 1];
var queryChainLengthMsg = () => ({'type': MessageType.QUERY_LATEST});
var queryAllMsg = () => ({'type': MessageType.QUERY_ALL});
var responseChainMsg = () =>({
    'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(blockchain)
});
var responseLatestMsg = () => ({
    'type': MessageType.RESPONSE_BLOCKCHAIN,
    'data': JSON.stringify([getLatestBlock()])
});

var write = (ws, message) => ws.send(JSON.stringify(message));
var broadcast = (message) => sockets.forEach(socket => write(socket, message));

connectToPeers(initialPeers);
initHttpServer();
initP2PServer();