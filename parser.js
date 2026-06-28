import bs58 from "bs58";

const DISCRIMINATORS = {
  create: Uint8Array.from([24, 30, 200, 40, 5, 28, 7, 119]),
  create_v2: Uint8Array.from([214, 144, 76, 236, 95, 139, 49, 180]),
  buy: Uint8Array.from([102, 6, 61, 18, 1, 218, 235, 234]),
  sell: Uint8Array.from([51, 230, 133, 164, 1, 127, 131, 173]),
};

const EVENT_DISCRIMINATORS = {
  createEvent: Uint8Array.from([27, 114, 169, 77, 222, 235, 99, 118]),
  tradeEvent: Uint8Array.from([189, 219, 127, 211, 78, 230, 97, 238]),
};

function toBase58(bytes) {
  if (typeof bytes === "string") return bytes;
  if (!bytes?.length) return null;
  if (bytes instanceof Uint8Array) return bs58.encode(bytes);
  return bs58.encode(new Uint8Array(bytes));
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

function matchesDiscriminator(data, discriminator) {
  if (data.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== discriminator[i]) return false;
  }
  return true;
}

function readI64LE(data, offset) {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  return Number(view.getBigInt64(0, true));
}

function skipAnchorString(data, offset) {
  const len = readU32LE(data, offset);
  return offset + 4 + len;
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

  // Full tail: is_mayhem_mode, is_cashback_enabled, quote_mint, virtual_quote_reserves
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
  const mint = toBase58(data.subarray(offset, offset + 32));
  offset += 32 + 8 + 8;
  const isBuy = data[offset] === 1;
  offset += 1 + 32;
  const timestamp = readI64LE(data, offset);

  return { mint, isBuy, timestamp };
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
  if (event.type === "buy") {
    return {
      timestamp: logEvents.tradeEvents.find(
        (e) => e.mint === event.mint && e.isBuy,
      )?.timestamp,
    };
  }
  if (event.type === "sell") {
    return {
      timestamp: logEvents.tradeEvents.find(
        (e) => e.mint === event.mint && !e.isBuy,
      )?.timestamp,
    };
  }
  return {};
}

function decodeAnchorString(data, offset) {
  const len = readU32LE(data, offset);
  const start = offset + 4;
  const value = new TextDecoder().decode(data.subarray(start, start + len));
  return { value, next: start + len };
}

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

function collectInstructions(txData) {
  const accountKeys = resolveAccountKeys(txData.message);
  const outer = (txData.message.instructions ?? []).map((ix) => ({
    ix,
    accountKeys,
  }));
  const inner = (txData.message.innerInstructions ?? []).flatMap((group) =>
    (group.instructions ?? []).map((ix) => ({ ix, accountKeys })),
  );
  return [...outer, ...inner];
}

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

function parseBuy(data, accounts) {
  if (data.length < 24) return null;

  return {
    type: "buy",
    mint: accounts[2],
    bondingCurve: accounts[3],
    user: accounts[6],
    amount: readU64LE(data, 8).toString(),
    maxSolCost: readU64LE(data, 16).toString(),
  };
}

function parseSell(data, accounts) {
  if (data.length < 24) return null;

  return {
    type: "sell",
    mint: accounts[2],
    bondingCurve: accounts[3],
    user: accounts[6],
    amount: readU64LE(data, 8).toString(),
    minSolOutput: readU64LE(data, 16).toString(),
  };
}

function parseInstruction(ix, accountKeys, programId) {
  const program = toBase58(accountKeys[ix.programIdIndex]);
  if (program !== programId) return null;

  const data = ix.data;
  const accounts = resolveAccounts(ix, accountKeys);

  if (matchesDiscriminator(data, DISCRIMINATORS.create)) {
    return parseCreate("create", data, accounts);
  }
  if (matchesDiscriminator(data, DISCRIMINATORS.create_v2)) {
    return parseCreate("create_v2", data, accounts);
  }
  if (matchesDiscriminator(data, DISCRIMINATORS.buy)) {
    return parseBuy(data, accounts);
  }
  if (matchesDiscriminator(data, DISCRIMINATORS.sell)) {
    return parseSell(data, accounts);
  }

  return null;
}

export function parseTxData(txData, programId) {
  const events = [];
  const logEvents = parseLogEvents(txData.logs);

  for (const { ix, accountKeys } of collectInstructions(txData)) {
    const event = parseInstruction(ix, accountKeys, programId);
    if (event) {
      events.push({
        ...event,
        signature: txData.signature,
        slot: txData.slot,
        ...enrichFromLogEvents(event, logEvents),
      });
    }
  }

  return events;
}
