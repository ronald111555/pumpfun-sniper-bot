require("dotenv").config();
const { Keypair, PublicKey } = require("@solana/web3.js");

const {
  default: Client,
  CommitmentLevel,
} = require("@triton-one/yellowstone-grpc");

const { createConnection, getTxData } = require("./utils");
const { parseTxData } = require("./utils/parser");
const { filterParsedTxData } = require("./utils/filter");
// const { execute } = require("./utils/execute-Jupiter");
// const { buy, sell } = require("./utils/execute-Pumpfun");

const { testDatabaseConnection } = require("./db");

const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT;
const GRPC_X_TOKEN = process.env.GRPC_X_TOKEN;
const PUMPFUN_PROGRAM_ID = process.env.PUMPFUN_PROGRAM_ID;
const RPC_ENDPOINT = process.env.RPC_ENDPOINT;
const RPC_WS_ENDPOINT = process.env.RPC_WS_ENDPOINT;

const client = new Client(GRPC_ENDPOINT, GRPC_X_TOKEN);
const connection = createConnection(RPC_ENDPOINT, RPC_WS_ENDPOINT);

async function main() {
  await testDatabaseConnection();

  const stream = await client.subscribe();

  stream.on("data", async (data) => {
    const txData = getTxData(data);
    if (!txData) return;

    const events = parseTxData(txData, PUMPFUN_PROGRAM_ID);

    const filterRes = await filterParsedTxData(events);

    // await sell(connection, "YNPbcC93C5rbnE3rzBKd88YSJhps8DaJdAVRWWupump"); // 0.21
    // await sell(connection, "3HdaLVX7VC69Md2JbPMGfBUjFg5QNNciNVb9op2Mpump"); // 0.23
    // await sell(connection, "8VE5zSBntuvx4GpE744EE8Y3tpPPtW437CE52KVZpump"); // 0.187
    // await sell(connection, "Bpfd3m66CV33Ae9t1p9eawbtn5d45RW5jfGW5s8tmCK6"); // 0.235

    // if (filterRes?.pass) {
    //   await buy(
    //     connection,
    //     filterRes.createEvent.mint,
    //     filterRes.createEvent.type,
    //     100,
    //   );
    // }

    // if (filterRes.pass)
    //   console.log(filterRes.createEvent, new Date().toUTCString());

    // Promise.all(
    //   events.map(async (event) => {
    //     if (event.type === "create" || event.type === "create_v2") {
    //       console.log(event);

    // const mintInfo = await getMintInfo(
    //   connection,
    //   event.mint,
    //   event.type,
    //   {
    //     bondingCurve: event.bondingCurve,
    //     uri: event.uri,
    //   },
    // );
    // console.log({
    //   ...event,
    //   mintInfo,
    //   updated: new Date().toISOString(),
    // });
    // const bondingCurve = new PublicKey(event.bondingCurve);
    // const subId = connection.onAccountChange(
    //   bondingCurve,
    //   (accountInfo, context) => {},
    //   { commitment: "processed" },
    // );
    // if (filterMintInfo(mintInfo).pass) {
    // console.log({
    //   ...event,
    //   mintInfo,
    //   updated: new Date().toISOString(),
    // });
    // console.log("passed");
    // // Buy
    // const buyResult = await execute(
    //   solMint,
    //   event.mint,
    //   10,
    //   10000,
    //   10,
    //   10,
    // );
    // console.log("buyResult:\n", buyResult);
    // const amount = buyResult?.outputAmountResult;
    // console.log("buyTokenAmount:", amount);
    // // Sell
    // const sellResult = await execute(
    //   event.mint,
    //   solMint,
    //   amount,
    //   5000,
    //   10,
    //   10,
    // );
    // } else {
    // console.log("not passed");
    // }
    //     } else {
    //       console.log(event);
    //     }
    //   }),
    // );
  });

  stream.on("error", (error) => {});

  stream.write({
    accounts: {},
    slots: {},
    transactions: {
      pumpfun: {
        vote: false,
        failed: false,
        accountInclude: [PUMPFUN_PROGRAM_ID],
        accountExclude: [],
        accountRequired: [],
      },
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
    commitment: CommitmentLevel.PROCESSED,
  });

  console.log("Listening to Pump.fun...");
}

main();
