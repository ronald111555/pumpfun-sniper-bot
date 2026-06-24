import bs58 from "bs58";

const DISCRIMINATORS = {
  create: Uint8Array.from([24, 30, 200, 40, 5, 28, 7, 119]),
  create_v2: Uint8Array.from([214, 144, 76, 236, 95, 139, 49, 180]),
  buy: Uint8Array.from([102, 6, 61, 18, 1, 218, 235, 234]),
  sell: Uint8Array.from([51, 230, 133, 164, 1, 127, 131, 173]),
};

function toBase58(bytes) {
  if (!bytes?.length) return null;
  return bs58.encode(bytes);
}

function readU32LE(data, offset) {
  return (
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24)
  ) >>> 0;
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

  for (const { ix, accountKeys } of collectInstructions(txData)) {
    const event = parseInstruction(ix, accountKeys, programId);
    if (event) {
      events.push({
        ...event,
        signature: txData.signature,
        slot: txData.slot,
      });
    }
  }

  return events;
}
