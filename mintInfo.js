import bs58 from "bs58";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

const BONDING_CURVE_DISC = Uint8Array.from([
  23, 183, 248, 55, 96, 216, 172, 96,
]);

function readU64(data, offset) {
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

function decodeBondingCurve(data) {
  if (!matchesDiscriminator(data, BONDING_CURVE_DISC)) return null;

  let offset = 8;
  const virtualTokenReserves = readU64(data, offset);
  offset += 8;
  const virtualQuoteReserves = readU64(data, offset);
  offset += 8;
  const realTokenReserves = readU64(data, offset);
  offset += 8;
  const realQuoteReserves = readU64(data, offset);
  offset += 8;
  const tokenTotalSupply = readU64(data, offset);
  offset += 8;
  const complete = data[offset] === 1;
  offset += 1;
  const creator = bs58.encode(data.subarray(offset, offset + 32));
  offset += 32;

  const curve = {
    virtualTokenReserves: virtualTokenReserves.toString(),
    virtualQuoteReserves: virtualQuoteReserves.toString(),
    realTokenReserves: realTokenReserves.toString(),
    realQuoteReserves: realQuoteReserves.toString(),
    tokenTotalSupply: tokenTotalSupply.toString(),
    complete,
    creator,
  };

  if (offset < data.length) {
    curve.isMayhemMode = data[offset] === 1;
    offset += 1;
  }
  if (offset < data.length) {
    curve.isCashbackCoin = data[offset] === 1;
    offset += 1;
  }
  if (offset + 32 <= data.length) {
    curve.quoteMint = bs58.encode(data.subarray(offset, offset + 32));
  }

  return curve;
}

function calcPriceSol(
  virtualQuoteReserves,
  virtualTokenReserves,
  decimals = 6,
) {
  if (virtualTokenReserves === 0n) return 0;
  const quote = Number(virtualQuoteReserves) / 1e9;
  const tokens = Number(virtualTokenReserves) / 10 ** decimals;
  return quote / tokens;
}

async function fetchMetadata(uri) {
  if (!uri) return null;

  try {
    const response = await fetch(uri, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function getMintInfo(connection, mint, type, options = {}) {
  const {
    bondingCurve: bondingCurveAddress,
    uri,
    decimals: decimalsOverride,
  } = options;

  const mintPubkey = new PublicKey(mint);
  const programId =
    type === "create_v2" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const mintAccount = await getMint(
    connection,
    mintPubkey,
    "processed",
    programId,
  );

  const info = {
    mint,
    decimals: mintAccount.decimals,
    supply: mintAccount.supply.toString(),
    mintAuthority: mintAccount.mintAuthority?.toBase58() ?? null,
    freezeAuthority: mintAccount.freezeAuthority?.toBase58() ?? null,
    isInitialized: mintAccount.isInitialized,
  };

  if (bondingCurveAddress) {
    const account = await connection.getAccountInfo(
      new PublicKey(bondingCurveAddress),
    );

    if (account?.data) {
      const curve = decodeBondingCurve(account.data);
      if (curve) {
        const decimals = decimalsOverride ?? mintAccount.decimals;
        const priceSol = calcPriceSol(
          BigInt(curve.virtualQuoteReserves),
          BigInt(curve.virtualTokenReserves),
          decimals,
        );
        const marketCapSol =
          priceSol * (Number(curve.tokenTotalSupply) / 10 ** decimals);

        info.bondingCurve = {
          address: bondingCurveAddress,
          ...curve,
          priceSol,
          marketCapSol,
        };
      }
    }
  }

  if (uri) {
    info.metadata = await fetchMetadata(uri);
  }

  return info;
}

export function createConnection(rpcEndpoint, wsEndpoint) {
  return new Connection(rpcEndpoint, {
    wsEndpoint: wsEndpoint,
    commitment: "processed",
  });
}
