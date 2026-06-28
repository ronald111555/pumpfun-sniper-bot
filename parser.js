import bs58 from "bs58";

// --- constants ---

const PUMP_FEES_PROGRAM_ID = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";

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

// --- binary helpers ---

function toBase58(bytes) {
  if (typeof bytes === "string") return bytes;
  if (!bytes?.length) return null;
  if (bytes instanceof Uint8Array) return bs58.encode(bytes);
  return bs58.encode(new Uint8Array(bytes));
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
  return [readU64LE(data, 8).toString(), readU64LE(data, 16).toString()];
}

function skipAnchorString(data, offset) {
  const len = readU32LE(data, offset);
  return offset + 4 + len;
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
    return new Uint8Array(Buffer.from(log.slice(prefix.length).trim(), "base64"));
  } catch {
    return null;
  }
}

// --- account helpers ---

function resolveAccountKeys(message) {
  return [
    ...(message.accountKeys ?? []),
    ...(message.loadedWritableAddresses ?? []),
    ...(message.loadedReadonlyAddresses ?? []),
  ];
}

function resolveAccounts(ix, accountKeys) {
  return (ix.accounts ?? []).map((index) => toBase58(accountKeys[index]));
}

function collectPumpInstructions(txData) {
  const accountKeys = resolveAccountKeys(txData.message);
  const items = [];

  (txData.message.instructions ?? []).forEach((ix, outerIndex) => {
    items.push({ ix, accountKeys, outerIndex });
  });

  for (const group of txData.message.innerInstructions ?? []) {
    const outerIndex = group.index ?? 0;
    for (const ix of group.instructions ?? []) {
      items.push({ ix, accountKeys, outerIndex });
    }
  }

  return items;
}

function parseLegacyTradeAccounts(accounts) {
  return {
    mint: accounts[LEGACY_TRADE_ACCOUNTS.mint],
    bondingCurve: accounts[LEGACY_TRADE_ACCOUNTS.bondingCurve],
    user: accounts[LEGACY_TRADE_ACCOUNTS.user],
  };
}

function parseV2TradeAccounts(accounts) {
  return {
    mint: accounts[V2_TRADE_ACCOUNTS.mint],
    quoteMint: accounts[V2_TRADE_ACCOUNTS.quoteMint],
    bondingCurve: accounts[V2_TRADE_ACCOUNTS.bondingCurve],
    user: accounts[V2_TRADE_ACCOUNTS.user],
  };
}

// --- pump fees program ---

function parseGetFeesInstruction(data) {
  if (!matchesDiscriminator(data, DISCRIMINATORS.getFees)) return null;
  if (data.length < 33) return null;

  const is_pump_pool = data[8] === 1;
  const market_cap_lamports = readU128LE(data, 9);
  if (market_cap_lamports == null) return null;

  return {
    is_pump_pool,
    market_cap_lamports,
    trade_size_lamports: readU64LE(data, 25).toString(),
  };
}

function buildGetFeesByOuterIndex(txData) {
  const accountKeys = resolveAccountKeys(txData.message);
  const map = new Map();

  for (const group of txData.message.innerInstructions ?? []) {
    const outerIndex = group.index ?? 0;

    for (const ix of group.instructions ?? []) {
      const program = toBase58(accountKeys[ix.programIdIndex]);
      if (program !== PUMP_FEES_PROGRAM_ID) continue;

      const fees = parseGetFeesInstruction(ix.data);
      if (fees) {
        map.set(outerIndex, fees);
        break;
      }
    }
  }

  return map;
}

function collectGetFeesList(txData) {
  const accountKeys = resolveAccountKeys(txData.message);
  const list = [];

  for (const group of txData.message.innerInstructions ?? []) {
    for (const ix of group.instructions ?? []) {
      const program = toBase58(accountKeys[ix.programIdIndex]);
      if (program !== PUMP_FEES_PROGRAM_ID) continue;

      const fees = parseGetFeesInstruction(ix.data);
      if (fees) list.push(fees);
    }
  }

  return list;
}

function findGetFees(event, outerIndex, getFeesByOuterIndex, getFeesList) {
  const byIndex = getFeesByOuterIndex.get(outerIndex);
  if (byIndex) return byIndex;

  if (event.type !== "buy" && event.type !== "sell") return null;

  const solAmount = event.solAmount;
  if (solAmount == null) return null;

  return getFeesList.find((fees) => fees.trade_size_lamports === solAmount) ?? null;
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
  if (!matchesDiscriminator(data, EVENT_DISCRIMINATORS.createEvent)) return null;

  let offset = 8;
  offset = skipAnchorString(data, offset);
  offset = skipAnchorString(data, offset);
  offset = skipAnchorString(data, offset);
  if (offset + 32 * 4 + 8 + 32 + 32 > data.length) return null;

  const mint = toBase58(data.subarray(offset, offset + 32));
  offset += 32 * 4;
  const timestamp = readI64LE(data, offset);
  offset += 8;

  const virtualTokenReserves = readU64LE(data, offset).toString();
  offset += 8;
  const virtualSolReserves = readU64LE(data, offset).toString();
  offset += 8;
  const realTokenReserves = readU64LE(data, offset).toString();
  offset += 8;
  const tokenTotalSupply = readU64LE(data, offset).toString();
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
    virtualQuoteReserves = readU64LE(data, offset + 34).toString();
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
  if (!matchesDiscriminator(data, EVENT_DISCRIMINATORS.tradeEvent)) return null;
  if (data.length < 97) return null;

  let offset = 8;

  const mint = readPubkeyAt(data, offset);
  offset += 32;
  const solAmount = readU64LE(data, offset).toString();
  offset += 8;
  const tokenAmount = readU64LE(data, offset).toString();
  offset += 8;
  const isBuy = data[offset] === 1;
  offset += 1;
  const user = readPubkeyAt(data, offset);
  offset += 32;
  const timestamp = readI64LE(data, offset);
  offset += 8;

  const readU64Field = () => {
    if (offset + 8 > data.length) return undefined;
    const value = readU64LE(data, offset).toString();
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

function parseLogEvents(logs) {
  const createEvents = [];
  const tradeEvents = [];

  for (const log of logs ?? []) {
    const data = decodeProgramData(log);
    if (!data) continue;

    const createEvent = parseCreateEvent(data);
    if (createEvent) {
      createEvents.push(createEvent);
      continue;
    }

    const tradeEvent = parseTradeEvent(data);
    if (tradeEvent) tradeEvents.push(tradeEvent);
  }

  return { createEvents, tradeEvents };
}

// --- event enrichment ---

function findTradeEvent(event, tradeEvents) {
  const isBuy = event.type === "buy";
  return (
    tradeEvents.find(
      (e) => e.mint === event.mint && e.isBuy === isBuy && e.user === event.user,
    ) ?? tradeEvents.find((e) => e.mint === event.mint && e.isBuy === isBuy)
  );
}

function enrichFromLogEvents(event, logEvents) {
  if (event.type === "create" || event.type === "create_v2") {
    const createEvent = logEvents.createEvents.find((e) => e.mint === event.mint);
    if (!createEvent) return {};
    return {
      timestamp: createEvent.timestamp,
      virtualTokenReserves: createEvent.virtualTokenReserves,
      virtualSolReserves: createEvent.virtualSolReserves,
      realTokenReserves: createEvent.realTokenReserves,
      tokenTotalSupply: createEvent.tokenTotalSupply,
      tokenProgram: createEvent.tokenProgram,
      isMayhemMode: createEvent.isMayhemMode,
      isCashbackEnabled: createEvent.isCashbackEnabled,
      quoteMint: createEvent.quoteMint,
      virtualQuoteReserves: createEvent.virtualQuoteReserves,
    };
  }

  if (event.type !== "buy" && event.type !== "sell") return {};

  const tradeEvent = findTradeEvent(event, logEvents.tradeEvents);
  if (!tradeEvent) return {};

  return {
    mint: tradeEvent.mint,
    solAmount: tradeEvent.solAmount,
    tokenAmount: tradeEvent.tokenAmount,
    isBuy: tradeEvent.isBuy,
    user: tradeEvent.user,
    timestamp: tradeEvent.timestamp,
    virtualTokenReserves: tradeEvent.virtualTokenReserves,
    virtualSolReserves: tradeEvent.virtualSolReserves,
    virtualQuoteReserves: tradeEvent.virtualQuoteReserves,
    realTokenReserves: tradeEvent.realTokenReserves,
    realSolReserves: tradeEvent.realSolReserves,
    realQuoteReserves: tradeEvent.realQuoteReserves,
    feeRecipient: tradeEvent.feeRecipient,
    feeBasisPoints: tradeEvent.feeBasisPoints,
    fee: tradeEvent.fee,
    creator: tradeEvent.creator,
    creatorFeeBasisPoints: tradeEvent.creatorFeeBasisPoints,
    creatorFee: tradeEvent.creatorFee,
    trackVolume: tradeEvent.trackVolume,
    totalUnclaimedTokens: tradeEvent.totalUnclaimedTokens,
    totalClaimedTokens: tradeEvent.totalClaimedTokens,
    currentSolVolume: tradeEvent.currentSolVolume,
    lastUpdateTimestamp: tradeEvent.lastUpdateTimestamp,
    ixName: tradeEvent.ixName,
    mayhemMode: tradeEvent.mayhemMode,
    cashbackFeeBasisPoints: tradeEvent.cashbackFeeBasisPoints,
    cashback: tradeEvent.cashback,
    buybackFeeBasisPoints: tradeEvent.buybackFeeBasisPoints,
    buybackFee: tradeEvent.buybackFee,
    shareholders: tradeEvent.shareholders,
    quoteMint: tradeEvent.quoteMint,
    quoteAmount: tradeEvent.quoteAmount,
  };
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

function parseLegacyTrade(type, accounts, ixData) {
  return { type, ...parseLegacyTradeAccounts(accounts), ixData };
}

function parseV2Trade(type, accounts, ixData) {
  return { type, ...parseV2TradeAccounts(accounts), ixData };
}

function parseBuy(data, accounts) {
  const args = readIxU64Pair(data);
  if (!args) return null;
  return parseLegacyTrade("buy", accounts, {
    amount: args[0],
    max_sol_cost: args[1],
  });
}

function parseBuyExactSolIn(data, accounts) {
  const args = readIxU64Pair(data);
  if (!args) return null;
  return parseLegacyTrade("buy", accounts, {
    spendable_sol_in: args[0],
    min_tokens_out: args[1],
  });
}

function parseBuyV2(data, accounts) {
  const args = readIxU64Pair(data);
  if (!args) return null;
  return parseV2Trade("buy", accounts, {
    amount: args[0],
    max_sol_cost: args[1],
  });
}

function parseBuyExactQuoteInV2(data, accounts) {
  const args = readIxU64Pair(data);
  if (!args) return null;
  return parseV2Trade("buy", accounts, {
    spendable_quote_in: args[0],
    min_tokens_out: args[1],
  });
}

function parseSell(data, accounts) {
  const args = readIxU64Pair(data);
  if (!args) return null;
  return parseLegacyTrade("sell", accounts, {
    amount: args[0],
    min_sol_output: args[1],
  });
}

function parseSellV2(data, accounts) {
  const args = readIxU64Pair(data);
  if (!args) return null;
  return parseV2Trade("sell", accounts, {
    amount: args[0],
    min_sol_output: args[1],
  });
}

const INSTRUCTION_PARSERS = [
  [DISCRIMINATORS.create, (data, accounts) => parseCreate("create", data, accounts)],
  [DISCRIMINATORS.create_v2, (data, accounts) => parseCreate("create_v2", data, accounts)],
  [DISCRIMINATORS.buy, parseBuy],
  [DISCRIMINATORS.buy_exact_sol_in, parseBuyExactSolIn],
  [DISCRIMINATORS.buy_v2, parseBuyV2],
  [DISCRIMINATORS.buy_exact_quote_in_v2, parseBuyExactQuoteInV2],
  [DISCRIMINATORS.sell, parseSell],
  [DISCRIMINATORS.sell_v2, parseSellV2],
];

function parseInstruction(ix, accountKeys, programId) {
  const program = toBase58(accountKeys[ix.programIdIndex]);
  if (program !== programId) return null;

  const data = ix.data;
  const accounts = resolveAccounts(ix, accountKeys);

  for (const [discriminator, parser] of INSTRUCTION_PARSERS) {
    if (matchesDiscriminator(data, discriminator)) {
      return parser(data, accounts);
    }
  }

  return null;
}

// --- main ---

export function parseTxData(txData, programId) {
  const events = [];
  const logEvents = parseLogEvents(txData.logs);
  const getFeesByOuterIndex = buildGetFeesByOuterIndex(txData);
  const getFeesList = collectGetFeesList(txData);

  for (const { ix, accountKeys, outerIndex } of collectPumpInstructions(txData)) {
    const event = parseInstruction(ix, accountKeys, programId);
    if (!event) continue;

    const merged = {
      ...event,
      signature: txData.signature,
      slot: txData.slot,
      ...enrichFromLogEvents(event, logEvents),
    };

    if (event.type === "buy" || event.type === "sell") {
      const fees = findGetFees(merged, outerIndex, getFeesByOuterIndex, getFeesList);
      if (fees) merged.getFees = fees;
    }

    events.push(merged);
  }

  return events;
}
