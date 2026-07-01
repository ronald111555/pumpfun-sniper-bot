"# pumpfun-sniper-bot"

1. Detect all txs in Pump.fun by gRPC
2. Parse Tx data into events which is just same as solscan

- We only consider event whose type is 'create', 'create_v2', 'buy' or 'sell'
- Tx is consist of instructions and instructions are consist of innerInstructions, as you can see on solscan
- Here createEvent and tradeEvent are so important, they shows create, buy and sell info

3. Filter parsed tx data (events)

- We observe new created tokens, so only consider Tx that events contain both 'create' (create_v2) and buy event
- Mostly , 'create' and 'buy' events are all in one Tx that new token is created, here 'buy' means creator's buy
- Get mint info using RPC and also metadata using fetch
- Save new created token's info in db
- Save if it is our target's buy tx to see what kinds of tokens he or she buys

4. send buy Tx on Pump.fun via web3.js
5. Here comes strategy to sell
6. send sell Tx on Pump.fun or Jupiter Api(if the token is migrated)
