import { PublicKey } from "@solana/web3.js";
import {
  getMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

// export function filterMintInfo(mintInfo) {
//   const bc = mintInfo?.bondingCurve;

//   // Safety filters
//   if (mintInfo?.mintAuthority !== null)
//     return { pass: false, reason: "Mint authority not renounced" };
//   if (mintInfo?.freezeAuthority !== null)
//     return { pass: false, reason: "Freeze authority exists" };
//   if (bc?.complete === true) return { pass: false, reason: "Already migrated" };
//   if (!bc) return { pass: false, reason: "Missing bonding curve data" };

//   // Liquidity filters
//   const realSOL = Number(bc?.realQuoteReserves) / 10 ** 9;
//   if (realSOL < 3) return { pass: false, reason: "Liquidity too low (<3 SOL)" };
//   if (realSOL > 200)
//     return { pass: false, reason: "Liquidity too high (>200 SOL)" };

//   // MarketCap filters
//   if (bc?.marketCapSol < 5)
//     return { pass: false, reason: "Too early / unstable MC" };
//   if (bc?.marketCapSol > 150)
//     return { pass: false, reason: "Already pumped too far" };

//   // Pass
//   return { pass: true, reason: "Passed all filters" };
// }

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

export async function filterParsedTxData(events, connection) {
  const createEvent = events.find(
    (event) => event.type === "create" || event.type === "create_v2",
  );
  const buyEvent = events.find((event) => event.type === "buy");

  if (!(createEvent && buyEvent))
    return { pass: false, reason: "createEvent or buyEvent not found" };

  const tokenProgram =
    createEvent.type === "create_v2" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const mintAccount = await getMint(
    connection,
    new PublicKey(createEvent.mint),
    "processed",
    tokenProgram,
  );
  if (mintAccount)
    createEvent.mintInfo = {
      mint: createEvent.mint,
      decimals: mintAccount.decimals,
      supply: mintAccount.supply.toString(),
      mintAuthority: mintAccount.mintAuthority?.toBase58() ?? null,
      freezeAuthority: mintAccount.freezeAuthority?.toBase58() ?? null,
      isInitialized: mintAccount.isInitialized,
    };

  createEvent.metadata = await fetchMetadata(createEvent.uri);

  console.log("================== Tx Start ==================");
  console.log(createEvent);
  console.log(buyEvent);
  console.log("================== Tx End ==================\n");

  return { pass: true, reason: "Passed all filters", createEvent };
}
