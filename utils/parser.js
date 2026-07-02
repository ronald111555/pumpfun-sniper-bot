const bs58 = require("bs58");

// --- constants ---

const PUMP_FEES_PROGRAM_ID = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

const SPL_IX = {
  initializeMint: 0,
  mintTo: 7,
  setAuthority: 6,
  transferChecked: 12,
  mintToChecked: 14,
  initializeMint2: 20,
};

const AUTHORITY_TYPE = {
  mintTokens: 0,
  freezeAccount: 1,
};

const DISCRIMINATORS = {
  create: Uint8Array.from([24, 30, 200, 40, 5, 28, 7, 119]),
  create_v2: Uint8Array.from([214, 144, 76, 236, 95, 139, 49, 180]),
  buy: Uint8Array.from([102, 6, 61, 18, 1, 218, 235, 234]),
  buy_exact_sol_in: Uint8Array.from([56, 252, 116, 8, 158, 223, 205, 95]),
  buy_v2: Uint8Array.from([184, 23, 238, 97, 103, 197, 211, 61]),
  buy_exact_quote_in_v2: Uint8Array.from([194, 171, 28, 70, 104, 77, 91, 47]),
  sell: Uint8Array.from([51, 230, 133, 164, 1, 127, 131, 173]),
  sell_v2: Uint8Array.from([93, 246, 130, 60, 231, 233, 64, 178]),
  getFees: Uint8Array.from([231, 37, 126, 85, 207, 91, 63, 52]),
};

const EVENT_DISCRIMINATORS = {
  createEvent: Uint8Array.from([27, 114, 169, 77, 222, 235, 99, 118]),
  tradeEvent: Uint8Array.from([189, 219, 127, 211, 78, 230, 97, 238]),
};

const LEGACY_TRADE_ACCOUNTS = { mint: 2, bondingCurve: 3, user: 6 };
const V2_TRADE_ACCOUNTS = { mint: 1, quoteMint: 2, bondingCurve: 10, user: 13 };

const CREATE_EVENT_FIELDS = [
  "timestamp",
  "virtualTokenReserves",
  "virtualSolReserves",
  "realTokenReserves",
  "tokenTotalSupply",
  "tokenProgram",
  "isMayhemMode",
  "isCashbackEnabled",
  "quoteMint",
  "virtualQuoteReserves",
];

const EMPTY_MINT_INFO = Object.freeze({
  decimals: null,
  mintAuthority: null,
  freezeAuthority: null,
  isInitialized: false,
  supply: "0",
});

const isTradeType = (type) => type === "buy" || type === "sell";
const isCreateType = (type) => type === "create" || type === "create_v2";
const isTokenProgram = (program) =>
  program === TOKEN_PROGRAM_ID || program === TOKEN_2022_PROGRAM_ID;
const isQuotePool = (event) =>
  Boolean(event.quoteMint && event.quoteMint !== WSOL_MINT);

// --- binary helpers ---

function toBase58(bytes) {
  if (typeof bytes === "string") return bytes;
  if (!bytes?.length) return null;
  if (bytes instanceof Uint8Array) return bs58.encode(bytes);
  return bs58.encode(new Uint8Array(bytes));
}

function toIxData(data) {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data ?? []);
}

function discKey(data) {
  let key = "";
  for (let i = 0; i < 8; i++) key += String.fromCharCode(data[i]);
  return key;
}

function matchesDiscriminator(data, discriminator) {
  if (data.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== discriminator[i]) return false;
  }
  return true;
}

function readU16LE(data, offset) {
  return data[offset] | (data[offset + 1] << 8);
}

function readU32LE(data, offset) {
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  );
}

function readU64LE(data, offset) {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  const low = view.getUint32(0, true);
  const high = view.getUint32(4, true);
  return BigInt(high) * 0x100000000n + BigInt(low);
}

function readU64String(data, offset) {
  return readU64LE(data, offset).toString();
}

function readI64LE(data, offset) {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  return Number(view.getBigInt64(0, true));
}

function readU128LE(data, offset) {
  if (offset + 16 > data.length) return null;
  const view = new DataView(data.buffer, data.byteOffset + offset, 16);
  const low = view.getBigUint64(0, true);
  const high = view.getBigUint64(8, true);
  return ((high << 64n) + low).toString();
}

function readPubkeyAt(data, offset) {
  return toBase58(data.subarray(offset, offset + 32));
}

function readIxU64Pair(data) {
  if (data.length < 24) return null;
  return [readU64String(data, 8), readU64String(data, 16)];
}

function skipAnchorString(data, offset) {
  return offset + 4 + readU32LE(data, offset);
}

function decodeAnchorString(data, offset) {
  const len = readU32LE(data, offset);
  const start = offset + 4;
  const value = new TextDecoder().decode(data.subarray(start, start + len));
  return { value, next: start + len };
}

function decodeProgramData(log) {
  const prefix = "Program data: ";
  if (!log.startsWith(prefix)) return null;
  try {
    return new Uint8Array(
      Buffer.from(log.slice(prefix.length).trim(), "base64"),
    );
  } catch {
    return null;
  }
}

function pickFields(source, fields) {
  const out = {};
  for (const field of fields) out[field] = source[field];
  return out;
}

// --- tx context ---

function resolveAccountKeys(message) {
  return [
    ...(message.accountKeys ?? []),
    ...(message.loadedWritableAddresses ?? []),
    ...(message.loadedReadonlyAddresses ?? []),
  ];
}

function resolveAccounts(ix, accountKeysBase58) {
  return (ix.accounts ?? []).map((index) => accountKeysBase58[index]);
}

function prepareTxContext(txData) {
  const accountKeys = resolveAccountKeys(txData.message);
  const accountKeysBase58 = accountKeys.map(toBase58);
  const logEvents = indexLogEvents(txData.logs);
  const { getFeesByOuterIndex, getFeesList, mints, transfersByOuter } =
    buildInnerInstructionMeta(txData, accountKeysBase58);
  const pumpInstructions = collectPumpInstructions(
    txData.message,
    accountKeys,
    accountKeysBase58,
  );

  return {
    accountKeys,
    accountKeysBase58,
    logEvents,
    getFeesByOuterIndex,
    getFeesList,
    tokenMeta: { mints, transfersByOuter },
    pumpInstructions,
  };
}

function collectPumpInstructions(message, accountKeys, accountKeysBase58) {
  const items = [];

  for (let outerIndex = 0; outerIndex < (message.instructions ?? []).length; outerIndex++) {
    items.push({
      ix: message.instructions[outerIndex],
      accountKeys,
      accountKeysBase58,
      outerIndex,
    });
  }

  for (const group of message.innerInstructions ?? []) {
    const outerIndex = group.index ?? 0;
    for (const ix of group.instructions ?? []) {
      items.push({ ix, accountKeys, accountKeysBase58, outerIndex });
    }
  }

  return items;
}

function parseTradeAccounts(accounts, layout) {
  const out = {
    mint: accounts[layout.mint],
    bondingCurve: accounts[layout.bondingCurve],
    user: accounts[layout.user],
  };
  if (layout.quoteMint != null) out.quoteMint = accounts[layout.quoteMint];
  return out;
}

// --- inner instruction meta (fees + SPL token) ---

function buildInnerInstructionMeta(txData, accountKeysBase58) {
  const getFeesByOuterIndex = new Map();
  const getFeesList = [];
  const mints = new Map();
  const transfersByOuter = new Map();

  for (const group of txData.message.innerInstructions ?? []) {
    const outerIndex = group.index ?? 0;

    for (const ix of group.instructions ?? []) {
      const program = accountKeysBase58[ix.programIdIndex];

      if (program === PUMP_FEES_PROGRAM_ID) {
        const fees = parseGetFeesInstruction(ix.data);
        if (fees) {
          getFeesList.push(fees);
          if (!getFeesByOuterIndex.has(outerIndex)) {
            getFeesByOuterIndex.set(outerIndex, fees);
          }
        }
        continue;
      }

      if (!isTokenProgram(program)) continue;

      const data = toIxData(ix.data);
      if (data.length === 0) continue;

      const accounts = resolveAccounts(ix, accountKeysBase58);
      let transfers = transfersByOuter.get(outerIndex);
      if (!transfers) {
        transfers = [];
        transfersByOuter.set(outerIndex, transfers);
      }

      const initMint = parseInitializeMint(data);
      if (initMint && accounts[0]) {
        mints.set(accounts[0], { ...initMint });
        continue;
      }

      const setAuthority = parseSetAuthority(data);
      if (setAuthority && accounts[0]) {
        let mintInfo = mints.get(accounts[0]);
        if (!mintInfo) {
          mintInfo = { ...EMPTY_MINT_INFO };
          mints.set(accounts[0], mintInfo);
        }
        applySetAuthority(mintInfo, setAuthority);
        continue;
      }

      const mintAmount = parseMintToAmount(data);
      if (mintAmount && accounts[0]) {
        const mintInfo = mints.get(accounts[0]);
        if (mintInfo) {
          mintInfo.supply = (
            BigInt(mintInfo.supply) + BigInt(mintAmount)
          ).toString();
        }
        continue;
      }

      const transfer = parseTransferChecked(data);
      if (transfer && accounts[1]) {
        transfers.push({ mint: accounts[1], ...transfer });
      }
    }
  }

  return { getFeesByOuterIndex, getFeesList, mints, transfersByOuter };
}

function parseGetFeesInstruction(data) {
  data = toIxData(data);
  if (!matchesDiscriminator(data, DISCRIMINATORS.getFees)) return null;
  if (data.length < 33) return null;

  const market_cap_lamports = readU128LE(data, 9);
  if (market_cap_lamports == null) return null;

  return {
    is_pump_pool: data[8] === 1,
    market_cap_lamports,
    trade_size_lamports: readU64String(data, 25),
  };
}

function findGetFees(event, outerIndex, getFeesByOuterIndex, getFeesList) {
  const byIndex = getFeesByOuterIndex.get(outerIndex);
  if (byIndex) return byIndex;
  if (!isTradeType(event.type)) return null;

  const tradeSize = getTradeSizeLamports(event);
  if (tradeSize == null) return null;

  for (const fees of getFeesList) {
    if (fees.trade_size_lamports === tradeSize) return fees;
  }
  return null;
}

// --- SPL token parsers ---

function parseCOptionPubkey(data, offset) {
  if (offset >= data.length) return { value: null, next: offset };
  const tag = data[offset];
  offset += 1;
  if (tag === 0) return { value: null, next: offset };
  if (tag !== 1 || offset + 32 > data.length) {
    return { value: null, next: offset };
  }
  return { value: readPubkeyAt(data, offset), next: offset + 32 };
}

function parseInitializeMint(data) {
  const ixType = data[0];
  if (ixType !== SPL_IX.initializeMint && ixType !== SPL_IX.initializeMint2) {
    return null;
  }
  if (data.length < 35) return null;

  let offset = 1;
  const decimals = data[offset++];
  const mintAuthority = readPubkeyAt(data, offset);
  offset += 32;
  const freezeAuthority = parseCOptionPubkey(data, offset).value;

  return {
    decimals,
    mintAuthority,
    freezeAuthority,
    isInitialized: true,
    supply: "0",
  };
}

function parseSetAuthority(data) {
  if (data[0] !== SPL_IX.setAuthority) return null;
  if (data.length < 3) return null;
  return {
    authorityType: data[1],
    newAuthority: parseCOptionPubkey(data, 2).value,
  };
}

function parseMintToAmount(data) {
  if (data[0] === SPL_IX.mintTo && data.length >= 9) {
    return readU64String(data, 1);
  }
  if (data[0] === SPL_IX.mintToChecked && data.length >= 10) {
    return readU64String(data, 1);
  }
  return null;
}

function parseTransferChecked(data) {
  if (data[0] !== SPL_IX.transferChecked) return null;
  if (data.length < 10) return null;
  return {
    amount: readU64String(data, 1),
    decimals: data[9],
  };
}

function applySetAuthority(mintInfo, setAuthority) {
  if (!mintInfo) return;
  if (setAuthority.authorityType === AUTHORITY_TYPE.mintTokens) {
    mintInfo.mintAuthority = setAuthority.newAuthority;
  } else if (setAuthority.authorityType === AUTHORITY_TYPE.freezeAccount) {
    mintInfo.freezeAuthority = setAuthority.newAuthority;
  }
}

function findTransferDecimals(transfers, mint, tokenAmount) {
  if (!transfers?.length || !mint) return null;

  if (tokenAmount != null) {
    for (const transfer of transfers) {
      if (transfer.mint === mint && transfer.amount === tokenAmount) {
        return transfer.decimals;
      }
    }
  }

  for (const transfer of transfers) {
    if (transfer.mint === mint) return transfer.decimals;
  }
  return null;
}

function attachTokenFields(event, outerIndex, tokenMeta) {
  const { mints, transfersByOuter } = tokenMeta;

  if (isCreateType(event.type)) {
    const parsed = mints.get(event.mint);
    if (!parsed) return;

    event.mintInfo = {
      decimals: parsed.decimals,
      supply: event.tokenTotalSupply ?? parsed.supply,
      mintAuthority: parsed.mintAuthority,
      freezeAuthority: parsed.freezeAuthority,
      isInitialized: parsed.isInitialized,
    };
    if (parsed.decimals != null) event.decimals = parsed.decimals;
    return;
  }

  if (!isTradeType(event.type)) return;

  const decimals = findTransferDecimals(
    transfersByOuter.get(outerIndex),
    event.mint,
    event.tokenAmount,
  );
  if (decimals != null) event.decimals = decimals;
}

// --- log event parsers ---

function parseShareholders(data, offset) {
  if (offset + 4 > data.length) return { value: undefined, next: offset };

  const len = readU32LE(data, offset);
  offset += 4;
  const shareholders = [];

  for (let i = 0; i < len; i++) {
    if (offset + 34 > data.length) break;
    shareholders.push({
      address: readPubkeyAt(data, offset),
      shareBps: readU16LE(data, offset + 32),
    });
    offset += 34;
  }

  return { value: shareholders, next: offset };
}

function parseCreateEvent(data) {
  let offset = 8;
  offset = skipAnchorString(data, offset);
  offset = skipAnchorString(data, offset);
  offset = skipAnchorString(data, offset);
  if (offset + 32 * 4 + 8 + 32 + 32 > data.length) return null;

  const mint = toBase58(data.subarray(offset, offset + 32));
  offset += 32 * 4;
  const timestamp = readI64LE(data, offset);
  offset += 8;

  const virtualTokenReserves = readU64String(data, offset);
  offset += 8;
  const virtualSolReserves = readU64String(data, offset);
  offset += 8;
  const realTokenReserves = readU64String(data, offset);
  offset += 8;
  const tokenTotalSupply = readU64String(data, offset);
  offset += 8;

  const tokenProgram = toBase58(data.subarray(offset, offset + 32));
  offset += 32;

  let isMayhemMode;
  let isCashbackEnabled;
  let quoteMint;
  let virtualQuoteReserves = virtualSolReserves;

  if (offset + 42 <= data.length) {
    isMayhemMode = data[offset] === 1;
    isCashbackEnabled = data[offset + 1] === 1;
    quoteMint = toBase58(data.subarray(offset + 2, offset + 34));
    virtualQuoteReserves = readU64String(data, offset + 34);
  } else if (offset + 2 <= data.length) {
    isMayhemMode = data[offset] === 1;
    isCashbackEnabled = data[offset + 1] === 1;
  } else if (offset + 1 <= data.length) {
    isMayhemMode = data[offset] === 1;
  }

  if (virtualQuoteReserves === "0") {
    virtualQuoteReserves = virtualSolReserves;
  }

  return {
    mint,
    timestamp,
    virtualTokenReserves,
    virtualSolReserves,
    realTokenReserves,
    tokenTotalSupply,
    tokenProgram,
    isMayhemMode,
    isCashbackEnabled,
    quoteMint,
    virtualQuoteReserves,
  };
}

function parseTradeEvent(data) {
  if (data.length < 97) return null;

  let offset = 8;
  const mint = readPubkeyAt(data, offset);
  offset += 32;
  const solAmount = readU64String(data, offset);
  offset += 8;
  const tokenAmount = readU64String(data, offset);
  offset += 8;
  const isBuy = data[offset] === 1;
  offset += 1;
  const user = readPubkeyAt(data, offset);
  offset += 32;
  const timestamp = readI64LE(data, offset);
  offset += 8;

  const readU64Field = () => {
    if (offset + 8 > data.length) return undefined;
    const value = readU64String(data, offset);
    offset += 8;
    return value;
  };

  const readPubkeyField = () => {
    if (offset + 32 > data.length) return undefined;
    const value = readPubkeyAt(data, offset);
    offset += 32;
    return value;
  };

  const readBoolField = () => {
    if (offset >= data.length) return undefined;
    const value = data[offset] === 1;
    offset += 1;
    return value;
  };

  const readI64Field = () => {
    if (offset + 8 > data.length) return undefined;
    const value = readI64LE(data, offset);
    offset += 8;
    return value;
  };

  const virtualSolReserves = readU64Field();
  const virtualTokenReserves = readU64Field();
  const realSolReserves = readU64Field();
  const realTokenReserves = readU64Field();
  const feeRecipient = readPubkeyField();
  const feeBasisPoints = readU64Field();
  const fee = readU64Field();
  const creator = readPubkeyField();
  const creatorFeeBasisPoints = readU64Field();
  const creatorFee = readU64Field();
  const trackVolume = readBoolField();
  const totalUnclaimedTokens = readU64Field();
  const totalClaimedTokens = readU64Field();
  const currentSolVolume = readU64Field();
  const lastUpdateTimestamp = readI64Field();

  let ixName;
  if (offset + 4 <= data.length) {
    const parsed = decodeAnchorString(data, offset);
    ixName = parsed.value;
    offset = parsed.next;
  }

  const mayhemMode = readBoolField();
  const cashbackFeeBasisPoints = readU64Field();
  const cashback = readU64Field();
  const buybackFeeBasisPoints = readU64Field();
  const buybackFee = readU64Field();

  const shareholdersParsed = parseShareholders(data, offset);
  const shareholders = shareholdersParsed.value;
  offset = shareholdersParsed.next;

  const quoteMint = readPubkeyField();
  const quoteAmount = readU64Field();
  let virtualQuoteReserves = readU64Field();
  let realQuoteReserves = readU64Field();

  if (virtualQuoteReserves == null || virtualQuoteReserves === "0") {
    virtualQuoteReserves = virtualSolReserves;
  }
  if (realQuoteReserves == null || realQuoteReserves === "0") {
    realQuoteReserves = realSolReserves;
  }

  return {
    mint,
    solAmount,
    tokenAmount,
    isBuy,
    user,
    timestamp,
    virtualTokenReserves,
    virtualSolReserves,
    virtualQuoteReserves,
    realTokenReserves,
    realSolReserves,
    realQuoteReserves,
    feeRecipient,
    feeBasisPoints,
    fee,
    creator,
    creatorFeeBasisPoints,
    creatorFee,
    trackVolume,
    totalUnclaimedTokens,
    totalClaimedTokens,
    currentSolVolume,
    lastUpdateTimestamp,
    ixName,
    mayhemMode,
    cashbackFeeBasisPoints,
    cashback,
    buybackFeeBasisPoints,
    buybackFee,
    shareholders,
    quoteMint,
    quoteAmount,
  };
}

function indexLogEvents(logs) {
  const createByMint = new Map();
  const tradesByMint = new Map();

  for (const log of logs ?? []) {
    const data = decodeProgramData(log);
    if (!data || data.length < 8) continue;

    if (matchesDiscriminator(data, EVENT_DISCRIMINATORS.createEvent)) {
      const createEvent = parseCreateEvent(data);
      if (createEvent) createByMint.set(createEvent.mint, createEvent);
      continue;
    }

    if (matchesDiscriminator(data, EVENT_DISCRIMINATORS.tradeEvent)) {
      const tradeEvent = parseTradeEvent(data);
      if (!tradeEvent) continue;

      let trades = tradesByMint.get(tradeEvent.mint);
      if (!trades) {
        trades = [];
        tradesByMint.set(tradeEvent.mint, trades);
      }
      trades.push(tradeEvent);
    }
  }

  return { createByMint, tradesByMint };
}

// --- event enrichment ---

function inferIxName(ixData) {
  if (!ixData) return undefined;
  if ("spendable_quote_in" in ixData) return "buy_exact_quote_in";
  if ("spendable_sol_in" in ixData) return "buy_exact_sol_in";
  if ("amount" in ixData && "max_sol_cost" in ixData) return "buy";
  if ("amount" in ixData && "min_sol_output" in ixData) return "sell";
  return undefined;
}

function getIxTradeSize(ixData) {
  if (!ixData) return null;
  return (
    ixData.spendable_quote_in ??
    ixData.spendable_sol_in ??
    ixData.amount ??
    null
  );
}

function getTradeSizeLamports(event) {
  const ixSize = getIxTradeSize(event.ixData);
  if (ixSize) return ixSize;
  if (event.solAmount && event.solAmount !== "0") return event.solAmount;
  if (event.quoteAmount && event.quoteAmount !== "0") return event.quoteAmount;
  return null;
}

function tradeEventAmountMatches(event, tradeEvent) {
  const ixSize = getIxTradeSize(event.ixData);
  if (!ixSize) return false;
  if (tradeEvent.solAmount === ixSize || tradeEvent.quoteAmount === ixSize) {
    return true;
  }

  const ixSizeBig = BigInt(ixSize);
  if (tradeEvent.quoteAmount && BigInt(tradeEvent.quoteAmount) <= ixSizeBig) {
    return true;
  }
  if (tradeEvent.solAmount && BigInt(tradeEvent.solAmount) <= ixSizeBig) {
    return true;
  }
  return false;
}

function findTradeEvent(event, tradesByMint) {
  const candidates = tradesByMint.get(event.mint);
  if (!candidates?.length) return null;

  const isBuy = event.type === "buy";
  const filtered = [];
  for (const trade of candidates) {
    if (trade.isBuy === isBuy) filtered.push(trade);
  }
  if (filtered.length === 0) return null;
  if (filtered.length === 1) return filtered[0];

  const byUser = [];
  for (const trade of filtered) {
    if (trade.user === event.user) byUser.push(trade);
  }
  if (byUser.length === 1) return byUser[0];

  const pool = byUser.length > 0 ? byUser : filtered;
  for (const trade of pool) {
    if (tradeEventAmountMatches(event, trade)) return trade;
  }
  return pool[0];
}

function normalizeTradeEventFields(event) {
  if (!isTradeType(event.type)) return;

  if (
    (!event.virtualQuoteReserves || event.virtualQuoteReserves === "0") &&
    event.virtualSolReserves
  ) {
    event.virtualQuoteReserves = event.virtualSolReserves;
  }
  if (
    (!event.realQuoteReserves || event.realQuoteReserves === "0") &&
    event.realSolReserves
  ) {
    event.realQuoteReserves = event.realSolReserves;
  }

  if (isQuotePool(event)) {
    if (
      (!event.quoteAmount || event.quoteAmount === "0") &&
      event.solAmount &&
      event.solAmount !== "0"
    ) {
      event.quoteAmount = event.solAmount;
    }
    return;
  }

  if (
    (!event.solAmount || event.solAmount === "0") &&
    event.quoteAmount &&
    event.quoteAmount !== "0"
  ) {
    event.solAmount = event.quoteAmount;
  }
}

function enrichFromInstructionData(event, outerIndex, tokenMeta) {
  if (!isTradeType(event.type)) return null;

  const fields = {
    isBuy: event.type === "buy",
    ixName: inferIxName(event.ixData),
  };

  const ixSize = getIxTradeSize(event.ixData);
  if (ixSize) {
    if (isQuotePool(event)) fields.quoteAmount = ixSize;
    else fields.solAmount = ixSize;
  }

  const transfers = tokenMeta.transfersByOuter.get(outerIndex);
  if (transfers?.length) {
    let tokenTransfer = null;
    for (const transfer of transfers) {
      if (transfer.mint !== event.mint) continue;
      if (
        !tokenTransfer ||
        BigInt(transfer.amount) > BigInt(tokenTransfer.amount)
      ) {
        tokenTransfer = transfer;
      }
    }

    if (tokenTransfer) {
      fields.tokenAmount = tokenTransfer.amount;
      if (event.decimals == null && tokenTransfer.decimals != null) {
        fields.decimals = tokenTransfer.decimals;
      }
    }
  }

  return fields;
}

function enrichFromLogEvents(event, logEvents) {
  if (isCreateType(event.type)) {
    const createEvent = logEvents.createByMint.get(event.mint);
    if (!createEvent) return null;
    return pickFields(createEvent, CREATE_EVENT_FIELDS);
  }

  if (!isTradeType(event.type)) return null;

  const tradeEvent = findTradeEvent(event, logEvents.tradesByMint);
  return tradeEvent ? { ...tradeEvent } : null;
}

function applyFallbackFields(target, fallback) {
  if (!fallback) return;
  for (const [key, value] of Object.entries(fallback)) {
    if (target[key] == null && value != null) target[key] = value;
  }
}

// --- instruction parsers ---

function parseCreateArgs(data) {
  if (data.length < 8) return null;

  let offset = 8;
  const name = decodeAnchorString(data, offset);
  offset = name.next;

  const symbol = decodeAnchorString(data, offset);
  offset = symbol.next;

  const uri = decodeAnchorString(data, offset);
  offset = uri.next;

  let creator;
  if (offset + 32 <= data.length) {
    creator = toBase58(data.subarray(offset, offset + 32));
  }

  return { name: name.value, symbol: symbol.value, uri: uri.value, creator };
}

function parseCreate(type, data, accounts) {
  const args = parseCreateArgs(data);
  if (!args) return null;

  const userIndex = type === "create_v2" ? 5 : 7;

  return {
    type,
    mint: accounts[0],
    bondingCurve: accounts[2],
    user: accounts[userIndex],
    creator: args.creator ?? accounts[userIndex],
    name: args.name,
    symbol: args.symbol,
    uri: args.uri,
  };
}

function parseTrade(type, accounts, ixData, layout) {
  return { type, ...parseTradeAccounts(accounts, layout), ixData };
}

function parseTradeIx(data, accounts, type, layout, ixDataKeys) {
  const args = readIxU64Pair(data);
  if (!args) return null;
  return parseTrade(type, accounts, ixDataKeys(args), layout);
}

const INSTRUCTION_PARSER_MAP = new Map([
  [
    discKey(DISCRIMINATORS.create),
    (data, accounts) => parseCreate("create", data, accounts),
  ],
  [
    discKey(DISCRIMINATORS.create_v2),
    (data, accounts) => parseCreate("create_v2", data, accounts),
  ],
  [
    discKey(DISCRIMINATORS.buy),
    (data, accounts) =>
      parseTradeIx(data, accounts, "buy", LEGACY_TRADE_ACCOUNTS, (args) => ({
        amount: args[0],
        max_sol_cost: args[1],
      })),
  ],
  [
    discKey(DISCRIMINATORS.buy_exact_sol_in),
    (data, accounts) =>
      parseTradeIx(data, accounts, "buy", LEGACY_TRADE_ACCOUNTS, (args) => ({
        spendable_sol_in: args[0],
        min_tokens_out: args[1],
      })),
  ],
  [
    discKey(DISCRIMINATORS.buy_v2),
    (data, accounts) =>
      parseTradeIx(data, accounts, "buy", V2_TRADE_ACCOUNTS, (args) => ({
        amount: args[0],
        max_sol_cost: args[1],
      })),
  ],
  [
    discKey(DISCRIMINATORS.buy_exact_quote_in_v2),
    (data, accounts) =>
      parseTradeIx(data, accounts, "buy", V2_TRADE_ACCOUNTS, (args) => ({
        spendable_quote_in: args[0],
        min_tokens_out: args[1],
      })),
  ],
  [
    discKey(DISCRIMINATORS.sell),
    (data, accounts) =>
      parseTradeIx(data, accounts, "sell", LEGACY_TRADE_ACCOUNTS, (args) => ({
        amount: args[0],
        min_sol_output: args[1],
      })),
  ],
  [
    discKey(DISCRIMINATORS.sell_v2),
    (data, accounts) =>
      parseTradeIx(data, accounts, "sell", V2_TRADE_ACCOUNTS, (args) => ({
        amount: args[0],
        min_sol_output: args[1],
      })),
  ],
]);

function parseInstruction(ix, accountKeysBase58, programId) {
  if (accountKeysBase58[ix.programIdIndex] !== programId) return null;

  const data = toIxData(ix.data);
  if (data.length < 8) return null;

  const parser = INSTRUCTION_PARSER_MAP.get(discKey(data));
  if (!parser) return null;

  return parser(data, resolveAccounts(ix, accountKeysBase58));
}

// --- main ---

function parseTxData(txData, programId) {
  const ctx = prepareTxContext(txData);
  const events = [];

  for (const {
    ix,
    accountKeysBase58,
    outerIndex,
  } of ctx.pumpInstructions) {
    const event = parseInstruction(ix, accountKeysBase58, programId);
    if (!event) continue;

    const merged = {
      ...event,
      signature: txData.signature,
      slot: txData.slot,
    };

    const logFields = enrichFromLogEvents(event, ctx.logEvents);
    if (logFields) Object.assign(merged, logFields);

    if (isTradeType(event.type)) {
      applyFallbackFields(
        merged,
        enrichFromInstructionData(merged, outerIndex, ctx.tokenMeta),
      );
    }

    attachTokenFields(merged, outerIndex, ctx.tokenMeta);

    if (isTradeType(event.type)) {
      const fees = findGetFees(
        merged,
        outerIndex,
        ctx.getFeesByOuterIndex,
        ctx.getFeesList,
      );
      if (fees) merged.getFees = fees;
      normalizeTradeEventFields(merged);
    }

    events.push(merged);
  }

  return events;
}

module.exports = { parseTxData };
