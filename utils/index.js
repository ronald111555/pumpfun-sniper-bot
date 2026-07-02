const { Connection } = require("@solana/web3.js");
const bs58 = require("bs58");

const createConnection = (rpcEndpoint, wsEndpoint) => {
  return new Connection(rpcEndpoint, {
    wsEndpoint: wsEndpoint,
    commitment: "processed",
  });
};

const getTxData = (data) => {
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

  return txData;
};

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const getQuoteDecimals = (quoteMint) => {
  if (quoteMint === USDC_MINT) return 6;
  return 9;
};

const calcPriceSol = (
  virtualQuoteReserves,
  virtualTokenReserves,
  decimals = 6,
  quoteDecimals = 9,
) => {
  if (virtualTokenReserves === 0n) return 0;
  const quote = Number(virtualQuoteReserves) / 10 ** quoteDecimals;
  const tokens = Number(virtualTokenReserves) / 10 ** decimals;
  return quote / tokens;
};

module.exports = {
  createConnection,
  getTxData,

  calcPriceSol,
  getQuoteDecimals,
  WSOL_MINT,
};
