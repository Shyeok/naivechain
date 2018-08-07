'use strict';
var CryptoJS = require("crypto-js");
var express = require("express");
var bodyParser = require('body-parser');
var WebSocket = require("ws");

//teamTx

let elliptic = require('elliptic');
let sha3 = require('js-sha3');
let ec = new elliptic.ec('secp256k1');

let keyPair = ec.genKeyPair();
let privKey = keyPair.getPrivate("hex");
let pubKey = keyPair.getPublic();

var http_port = process.env.HTTP_PORT || 3001;
var p2p_port = process.env.P2P_PORT || 6001;
var initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];

// teamb
class Block {

    constructor(index, previousHash, timestamp, data, hash, targetvalue) {

        this.index = index;
        this.previousHash = previousHash.toString();
        this.timestamp = timestamp;
        this.data = data;
        this.hash = hash.toString();
        this.nonce = 0;
        this.targetvalue = targetvalue;
        this.tx_set = [];
        this.root = "";
    }
}

//teamb
class Merkle_Tree {

    constructor (){

        this.index = 0;
        this.node_values = [];
        this.root = "";

    }
}

var TransactionPool = new Array();

class Transaction {
    constructor(sender, receiver, value, pubKey, in_counter, out_counter, transactionHash, inputs, outputs) {   // 수정 요망
        
        //transactionHash,in_counter, inputs, out_counter, outputs
        this.sender = sender;
        this.receiver = receiver;
        this.value = value;
        
        this.in_counter = in_counter; // self initialize

        this.out_counter = out_counter;
        
        this.msgHash = NaN;
        //tx 발생자의 개인 서명, 잠금스크립트를 풀기위한 열쇠.
        this.Sig = NaN;
        //tx를 검증하고 서명을 확인한다.자물쇠의 역할
        this.pubKey = pubKey;

        //teamTx        
        for(var i=0; i<in_counter; i++){
            this.inputs[i].txid = inputs[i].txid.toString();
            this.inputs[i].sequence = inputs[i].sequence;
        }
        for(var i=0; i<out_counter; i++){
            this.outputs[i].value = outputs[i].value;
            this.outputs[i].sig = outputs[i].sig.toString();
        }
        this.outputs = [outputs];
        //this.transactionHash = CryptoJS.SHA256(in_counter + [inputs] + out_counter + [outputs]).toString();
        //calculate transaction hash directly, not using passed parameter
        this.transactionHash = transactionHash.toString();

    }
}



// 상연아!!
/*var memory_pool = [{ "sender": "a", "reciver": "b", "amount": 100 }, 
    { "sender": "b", "reciver": "c", "amount": 150 }, 
    { "sender": "baa", "reciver": "c", "amount": 150 }, 
    { "sender": "ab", "reciver": "c", "amount": 150 }]; // memory_pool add*/

var memory_pool = [];

var sockets = [];

var MessageType = {
    QUERY_LATEST: 0,
    QUERY_ALL: 1,
    RESPONSE_BLOCKCHAIN: 2,
    RESPONSE_Transaction: 3

};

var getGenesisBlock = () => {

    var newBlock = new Block(0, "0", 0, "My Genesis block", "0", "0AAA");
    return newBlock;
};

var memPool = [];
var UTXOsets = [];
var mk_db = []; // teamb

var initMemPool = () => {
    memPool.push({transactionHash:"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",in_counter:1,inputs:
    [{txid: "84909c7ba11f17777bb9eda44b77e48fbe77e23797ed25a711507a41288e7133", sequence:3}],out_counter:
    1,outputs:[{value:0.5,sig:"656c61a876b3c6118e25b49adcaeda2b449a256a843c8e2c74f02553c828699b"}]});

    memPool.push({transactionHash:"a441b15fe9a3cf56661190a0b93b9dec7d04127288cc87250967cf3b52894d11",in_counter:1,inputs:
    [{txid:"82ee2898a1d083a3ce2a8e8d2f44be000a4f660a42df42ce8f20c857f3aefefa",sequence:0}],out_counter:
    1,outputs:[{value:0.5,sig:"e4bda23f74a779e9ad8216e38de099d1a73538476ba6459fb8c70757280d8374"}]});
    

    memPool.push({transactionHash:"0e1737cc61216df82ad94125c977e70a8fd916c3f67a655a815ee199b79eed20",in_counter:1,inputs:
    [{txid: "41313f3e4051927cac9f41d6d272a9635100fc294a1ece335b67cc57ac2eae0f", sequence: 0}],out_counter:
    2,outputs:[{value:1.2,sig:"bb58e7826653e1a7cda3992e4f78dd34f1a4475394ee035dac86d1c427078caa"},{value:0.5,sig:"8706df381667b49358919ef5dd848ca1998179a4ed07f9912a40322cc0460e1b"}]});
}

var blockchain = [getGenesisBlock()];


// 명령어 처리

var initHttpServer = () => {
    var app = express();
    app.use(bodyParser.json());

    app.get('/blocks', (req, res) => res.send(JSON.stringify(blockchain)));
    app.get('/mempool', (req, res) => res.send(JSON.stringify(memPool)));
    
    // Gensis block 설정
    app.post('/setGenesis', (req, res) => {
        
        var a = blockchain.length;
        console.log(JSON.stringify(a));
        if(a != 0) console.log("gensis block exists");
        else{
            var currentTimestamp = new Date().getTime() / 1000;
            
            var new_block = new Block(a, "0", 0, req.body.data, "", 0, "0AAA");

            var blockHash = calculateHashForBlock(new_block);

            new_block.hash = blockHash.toString();
            
            blockchain.push(new_block);
        }
        res.send(JSON.stringify(blockchain)); 
    }); 

    // block 생성
    app.post('/mineBlock', (req, res) => {

        // memory pool이 다 만들어 지지 않아서 Transaction Pool로 사용
        var newBlock = generateNextBlock(req.body.data, TransactionPool); // Using req.body.data for labeling block

        console.log(JSON.stringify(TransactionPool));

        addBlock(newBlock);
        broadcast(responseLatestMsg());
        console.log('block added: ' + JSON.stringify(newBlock));
        res.send();

    });

    // 연결되 peer 확인
    app.get('/peers', (req, res) => {
        res.send(sockets.map(s => s._socket.remoteAddress + ':' + s._socket.remotePort));
    });

    // 연결되는 peer 추가
    app.post('/addPeer', (req, res) => {
        connectToPeers([req.body.peer]);
        res.send();
    });

    // Transaction Pool 확인
    app.get('/transactions', (req, res) => res.send(JSON.stringify(TransactionPool)));

    //Transaction 생성
    app.post('/newTransaction', (req, res) => {

        // transaction value setting
        console.log("helelo");
        var newSender = req.body.sender;
        var newReceiver = req.body.receiver;
        var newValue = req.body.value;
        var newpubKey = req.body.pubKey;
        var newin_counter= req.body.in_counter;
        var newout_counter= req.body.out_counter;
        var newtransactionHash= req.body.transactionHash;
        var newinputs= req.body.inputs;
        var newoutputs= req.body.outputs;

        var newTransaction = generateNewTransaction(newSender, newReceiver, newValue, pubKey, newin_counter, newout_counter, newtransactionHash, newinputs, newoutputs);

        // msgHash
        let msgHash = sha3.keccak256("what should we put here?????????");
        newTransaction.msgHash = msgHash;
        let signature = ec.sign(msgHash, privKey, "hex", { canonical: true });
        newTransaction.Sig = signature;
        newTransaction.pubKey = pubKey;

        //tx풀에 추가.
        addTransaction(newTransaction);

        broadcast(responseTxMsg());
        console.log('New Tx: ' + JSON.stringify(newTransaction));

        res.send();
    });

   
    //삭제 요망
    app.post('/isValidNewBlock', (req, res) => {
        var tmp = isValidNewBlock(req.body,blockchain[0]);
        if(tmp){
            // add new block to blockchain
            // add outputs to UTXO set
            res.send("Valid Block");
        }
        else{
            res.send("Invalid Block");
        }
    });

    
    app.listen(http_port, () => console.log('Listening http on port: ' + http_port));
};
var addToMempool = (newTransaction) => {
    memPool.push({transactionHash:newTransaction.transactionHash,in_counter:newTransaction.in_counter,inputs:
    newTransaction.inputs,out_counter:
    newTransaction.out_counter,outputs:newTransaction.outputs});
}
var addToUTXO = (newTransaction) => {
    UTXOsets.push(newTransaction.outputs);
}
var isValidTransaction = (newTransaction) => {
    // check if every data field are non-empty
    if (newTransaction.transactionHash == null || // 나중에 제거하기
        newTransaction.in_counter == null || 
        newTransaction.inputs == null || 
        newTransaction.out_counter == null ||
         newTransaction.outputs == null) {
        console.log("Invalid transacion format");
        return false;
    }

    // check if is there any negative outputs
    for(var i=0; i<newTransaction.out_counter; i++ ){
        if(newTransaction.outputs[i].value < 0){
            console.log("Negative output");
            return false;
        }
    }

    // 0 < sum of outputs < 21,000,000
    var sum = 0;
    for(var i=0; i<newTransaction.out_counter; i++ )
        sum += newTransaction.outputs[i].value;    
    if(sum<=0||sum>21000000){
        console.log("Sum of outputs must be 0 ~ 21,000,000")
        return false;
    }

    // check if hash is 0 and sequence(index) is negative
    for(var i=0; i<newTransaction.in_counter; i++ ){   
        if(newTransaction.inputs[i].txid == "0" || newTransaction.inputs[i].sequence < 0)   {
            
            return false;
        }
    }
    
    
    sum = 0;
    // check if inputs of transaction exist in memPool or main block
    for(var i=0; i<newTransaction.in_counter; i++){
        // check memPool
        var flag = false;
        for(var j=0; j<memPool.length; j++){
            if(newTransaction.inputs[i].txid == memPool[j].transactionHash){
                flag = true;
                // add value of outputs
                sum += memPool[j].outputs[newTransaction.inputs[i].sequence].value;
                break;
            }
        }
        if(flag)
            continue;
        // check main block branch

        if(!flag){
            console.log("no memPool");
            return false;
        }
    }

    // check if sum of input values are less than sum of outputs
    for(var i=0; i<newTransaction.out_counter; i++)
        sum -= newTransaction.outputs[i].value;
    if(sum<0)
        return false;

    // check if double-spended in memPool
    // 너무 무식하게 코딩함 수정좀
    for(var i=0; i<newTransaction.in_counter; i++){
        for(var j=0; j<memPool.length; j++){
            for(var k=0; k<memPool[j].in_counter; k++){
                if(newTransaction.inputs[i].txid == memPool[j].inputs[k].txid){
                    return false;
                }
            }
        }
    }
    return true;
};

var initP2PServer = () => {
    var server = new WebSocket.Server({port: p2p_port});
    server.on('connection', ws => initConnection(ws));
    console.log('listening websocket p2p port on: ' + p2p_port);

};

var initConnection = (ws) => {
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
            case MessageType.RESPONSE_Transaction:
                handleTxResponse(message);
                break;
                //mm

                
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

// 블록 생성 부분
var generateNextBlock = (blockData, m_pool) => {

    m_pool.unshift({ "sender" : "X", "receiver" : "3001", "value" : "25",  
    "in_counter" : "0",  "out_counter" : "1",  
    "transactionHash" : "1",  "inputs" : "0",  "outputs" : "1"  }); // add coinbase

    var previousBlock = getLatestBlock();

    var nextIndex = previousBlock.index + 1;

    var nextTimestamp = new Date().getTime() / 1000;
    
    var nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimestamp, blockData);

    var new_block = new Block(nextIndex, previousBlock.hash, nextTimestamp, blockData, nextHash, "0AAA");

    var transaction_num = 0;

    var block_transactions = [];

    while(transaction_num <= 4 && m_pool.length != 0) { // assume block size is 3 transaction

        transaction_num += 1;

        var new_transaction = m_pool.shift();

        block_transactions.push(new_transaction);

    }


    new_block.tx_set = block_transactions;

    makemerkletree(new_block, new_block.tx_set);

    ProofofWork(new_block);
    
    console.log(JSON.stringify(memory_pool));

    return new_block;

};


var makemerkletree = (block, block_Transactions) => { // make merkle tree node's value 상연아!!

    var index_s = 0;
    var index_e = 0;
    var mk_vals = new Merkle_Tree();
  
    mk_vals.index = block.index;
    
    for( var i in block_Transactions){

        var tx_st = JSON.stringify(block_Transactions[i]);
        var h_val = CryptoJS.SHA256(tx_st).toString();
        mk_vals.node_values.push(h_val);

    }

    index_s = 0;
    index_e = block_Transactions.length;

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

      //  console.log(index_s);
      //  console.log(index_e);

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

       // console.log(res_val);
       // console.log(block.targetvalue);
    }

}


//teamTx

var generateNewTransaction = (sender, receiver, amount, pubKey, in_counter, out_counter, transactionHash, inputs, outputs) => {
    var aTransaction = new Transaction(sender, receiver, amount, pubKey, in_counter, out_counter, transactionHash, inputs, outputs); // TxHash, input_counter,inputs, output_counter, outputs
    return aTransaction;
};

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

//teamTx
var addTransaction = (newTransaction) => {
    //if( isValidNewTransaction(newTransaction) ){
    TransactionPool.push(newTransaction);
    //}
}

var isValidNewBlock = (newBlock, previousBlock) => {

    console.log("block valid check");

    // check if standard format
    if(newBlock.index == null || 
        newBlock.previousHash == null ||
        newBlock.timestamp == null ||
        newBlock.data == null ||
        newBlock.targetvalue == null ||
        newBlock.nonce == null){
        console.log('invalid block format');
        return false;
    }

    // chekc if difficulty is valid
    
    var h_val = CryptoJS.SHA256(newBlock.root + (newBlock.index).toString() + newBlock.data + (newBlock.nonce).toString()).toString();
    var res_val = h_val.substring(0,3);

    if(res_val >= newBlock.targetvalue){
        console.log("invalid nonce");
        return false;
    }

    // check if within 2 hours
    if(newBlock.timestamp + 72000 < Math.floor(new Date().getTime() / 1000)){
        console.log('invalid timestamp(more than 2 hours)');
        return false;
    }

    // check if all transactions are valid
    // not yet

    // check block height
    if (previousBlock.index + 1 !== newBlock.index) {
        console.log('invalid index');
        return false;
    } 
    
    // check previous block hash

    if (previousBlock.hash !== newBlock.previousHash) {
        console.log('invalid previoushash');
        return false;
    }
    
    // check if block hash is right
    else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
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

//teamTx
//
var handleTxResponse = (message) => {
    //재호씨가 보내주신 코드 이용했습니다.https://gist.github.com/nakov/1dcbe26988e18f7a4d013b65d8803ffc
    var receivedTx = JSON.parse(message.data).sort((t1, t2) => (t1.index - t2.index));
    /*
        JSON.parse() 는 String을 Object로 변환하는 데 사용됩니다. 
        JSON.stringify() 는 Object를 String으로 변환하는 데 사용됩니다
    */
    var receivedTx_A = JSON.stringify(receivedTx[0]);
    receivedTx_A = JSON.parse(receivedTx_A);

    var msgHash_A = receivedTx_A['msgHash'];
    var Sig_A = receivedTx_A['Sig'];

    //확인용
    //console.log(`msgHash_A: ${msgHash_A}`);
    //console.log(`Sig_A: ${Sig_A}`);
    //console.log(receivedTx_A);
    //console.log(receivedTx_A['msgHash']);

    //?코드 이해해서 옮긴거긴 한데 이 부분에 pubkey사용 안하고 어떻게 sig를 풀었지???
    let hexToDecimal = (x) => ec.keyFromPrivate(x, "hex").getPrivate().toString(10);
    let pubKeyRecovered = ec.recoverPubKey(
    hexToDecimal(msgHash_A), Sig_A, Sig_A.recoveryParam, "hex");
    let validSig = ec.verify(msgHash_A, Sig_A, pubKeyRecovered);
    if (validSig == true) {
        //이게아니라
        //addTransaction(receivedTx_A);     
        //이거겠지?
        addTransaction(receivedTx);

        console.log('valid transaction , New Transaction received.')
    }
}

//



var handleBlockchainResponse = (message) => {
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

var replaceChain = (newBlocks) => {
    if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
        console.log('Received blockchain is valid. Replacing current blockchain with received blockchain');
        blockchain = newBlocks;
        broadcast(responseLatestMsg());
    } else {
        console.log('Received blockchain invalid');
    }
};

var isValidChain = (blockchainToValidate) => { // Optimazation
    if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(getGenesisBlock())) { // 상연아!!!
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
var getLatestTx = () => TransactionPool[TransactionPool.length - 1];

var queryChainLengthMsg = () => ({'type': MessageType.QUERY_LATEST});
var queryAllMsg = () => ({'type': MessageType.QUERY_ALL});
var responseChainMsg = () =>({
    'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(blockchain)
});
var responseLatestMsg = () => ({
    'type': MessageType.RESPONSE_BLOCKCHAIN,
    'data': JSON.stringify([getLatestBlock()])
});

/* 
 *  message reqest for new transaction occured. 
 *  teamTx
*/
var responseTxMsg = () => ({

    'type': MessageType.RESPONSE_Transaction,
    'data': JSON.stringify([getLatestTx()])

})




var write = (ws, message) => ws.send(JSON.stringify(message));
var broadcast = (message) => sockets.forEach(socket => write(socket, message));

connectToPeers(initialPeers);
initHttpServer();
initP2PServer();
initMemPool();
