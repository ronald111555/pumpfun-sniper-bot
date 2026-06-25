import "dotenv/config";
import bs58 from "bs58";
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";
import { parseTxData } from "./parser.js";
import { createConnection, getMintInfo } from "./mintInfo.js";

const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT;
const GRPC_X_TOKEN = process.env.GRPC_X_TOKEN;
const PUMPFUN_PROGRAM_ID = process.env.PUMPFUN_PROGRAM_ID;
const RPC_ENDPOINT = process.env.RPC_ENDPOINT;

const client = new Client(GRPC_ENDPOINT, GRPC_X_TOKEN);
const connection = createConnection(RPC_ENDPOINT);

async function main() {
  const stream = await client.subscribe();

  stream.on("data", async (data) => {
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

    for (const event of events) {
      if (event.type === "create" || event.type === "create_v2") {
        const mintInfo = await getMintInfo(connection, event.mint, event.type, {
          bondingCurve: event.bondingCurve,
          uri: event.uri,
        });
        console.log({
          ...event,
          mintInfo,
          detected: new Date().toUTCString(),
        });
      } else {
        // TODO: handle other event types
        // console.log(event);
      }
    }
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
    commitment: CommitmentLevel.CONFIRMED,
  });

  console.log("Listening to Pump.fun...");
}

main();
