import "dotenv/config";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";
import { parseTxData } from "./parser.js";
import { createConnection, getMintInfo } from "./mintInfo.js";

import { filterMintInfo } from "./filter.js";
import { execute } from "./execute.js";

const solMint = process.env.SOL_MINT;

const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT;
const GRPC_X_TOKEN = process.env.GRPC_X_TOKEN;
const PUMPFUN_PROGRAM_ID = process.env.PUMPFUN_PROGRAM_ID;
const RPC_ENDPOINT = process.env.RPC_ENDPOINT;
const RPC_WS_ENDPOINT = process.env.RPC_WS_ENDPOINT;

const client = new Client(GRPC_ENDPOINT, GRPC_X_TOKEN);
const connection = createConnection(RPC_ENDPOINT, RPC_WS_ENDPOINT);

async function main() {
  const stream = await client.subscribe();

  stream.on("data", (data) => {
    if (!data.transaction) return;

    const slot = data.transaction.slot;

    const txInfo = data.transaction.transaction;
    if (!txInfo?.transaction?.message) return;

    const signature =
      typeof txInfo.signature === "string"
        ? txInfo.signature
        : bs58.encode(txInfo.signature);
    const message = txInfo.transaction.message;

    const accountKeys = (message.accountKeys ?? []).map(
      (key) => new Uint8Array(key),
    );
    const instructions = (message.instructions ?? []).map((ix) => ({
      programIdIndex: ix.programIdIndex,
      accounts: Array.from(ix.accounts),
      data: new Uint8Array(ix.data ?? []),
    }));

    const meta = txInfo.meta;
    const loadedWritable = (meta?.loadedWritableAddresses ?? []).map(
      (k) => new Uint8Array(k),
    );
    const loadedReadonly = (meta?.loadedReadonlyAddresses ?? []).map(
      (k) => new Uint8Array(k),
    );
    const logs = meta?.logMessages ?? [];

    const innerInstructions = (meta?.innerInstructions ?? []).map((group) => ({
      index: group.index ?? 0,
      instructions: (group.instructions ?? []).map((ix) => ({
        programIdIndex: ix.programIdIndex ?? 0,
        accounts: Array.from(ix.accounts),
        data: new Uint8Array(ix.data ?? []),
      })),
    }));

    const txData = {
      signature,
      slot,
      message: {
        accountKeys,
        instructions,
        innerInstructions,
        versioned: message.versioned,
        loadedWritableAddresses: loadedWritable,
        loadedReadonlyAddresses: loadedReadonly,
      },
      logs,
    };

    const events = parseTxData(txData, PUMPFUN_PROGRAM_ID);

    Promise.all(
      events.map(async (event) => {
        if (event.type === "create" || event.type === "create_v2") {
          console.log({ ...event, detected: new Date().toUTCString() });
          const mintInfo = await getMintInfo(
            connection,
            event.mint,
            event.type,
            {
              bondingCurve: event.bondingCurve,
              uri: event.uri,
            },
          );

          console.log({
            ...event,
            mintInfo,
            updated: new Date().toISOString(),
          });

          // const bondingCurve = new PublicKey(event.bondingCurve);
          // const subId = connection.onAccountChange(
          //   bondingCurve,
          //   (accountInfo, context) => {},
          //   { commitment: "processed" },
          // );
          // if (filterMintInfo(mintInfo).pass) {
          //   console.log("passed");
          //   // Buy
          //   const buyResult = await execute(
          //     solMint,
          //     event.mint,
          //     10,
          //     5000,
          //     10,
          //     10,
          //   );
          //   const amount = buyResult?.outputAmountResult;
          //   console.log("buyTokenAmount:", amount);
          //   // Sell
          //   const sellResult = await execute(
          //     event.mint,
          //     solMint,
          //     amount,
          //     5000,
          //     10,
          //     10,
          //   );
          // } else {
          //   console.log("not passed");
          // }
        } else {
          // TODO: handle other event types
        }
      }),
    );
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
