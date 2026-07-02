// const { targets } = require("../targets");
// const { postWalletTrack, postToken } = require("../db");

const { calcPriceSol, getQuoteDecimals } = require("./index");

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

async function filterParsedTxData(events) {
  try {
    if (
      events.length === 2 &&
      (events[0].type === "create" || events[0].type === "create_v2") &&
      events[1].type === "buy"
    ) {
      const createEvent = events[0];
      const buyEvent = events[1];
      createEvent.metadata = await fetchMetadata(createEvent.uri);

      // Safety filter
      if (createEvent.isMayhemMode === true)
        return { pass: false, reason: "Mayhem mode is true" };
      if (createEvent.mintInfo.mintAuthority !== null)
        return { pass: false, reason: "Mint authority is not null" };
      if (createEvent.mintInfo.freezeAuthority !== null)
        return { pass: false, reason: "Freeze authority is not null" };
      if (createEvent.mintInfo.isInitialized === false)
        return { pass: false, reason: "Not initialized" };
      // liquidity filter
      const quoteMint = buyEvent.quoteMint ?? createEvent.quoteMint;
      const quoteDecimals = getQuoteDecimals(quoteMint);
      const realQuote =
        Number(buyEvent.realQuoteReserves ?? buyEvent.realSolReserves ?? 0) /
        10 ** quoteDecimals;
      if (realQuote < 0.5)
        return { pass: false, reason: "Liquidity too low (<0.5 quote)" };
      if (realQuote > 20)
        return { pass: false, reason: "Liquidity too high (>20 quote)" };

      // MarketCap filter
      const priceSol = calcPriceSol(
        buyEvent.virtualQuoteReserves ?? buyEvent.virtualSolReserves,
        buyEvent.virtualTokenReserves ?? buyEvent.realTokenReserves,
        buyEvent.decimals,
        quoteDecimals,
      );
      const marketCapSol =
        (priceSol * Number(createEvent.tokenTotalSupply)) /
        10 ** createEvent.decimals;

      if (marketCapSol < 20)
        return { pass: false, reason: "Too early / unstable MC" };
      if (marketCapSol > 70)
        return { pass: false, reason: "Already pumped too far" };

      console.log("================== Tx Start ==================");
      console.log(createEvent);
      console.log(buyEvent);
      console.log("marketCapSol: ", marketCapSol);
      console.log(new Date().toUTCString());
      console.log("================== Tx End ==================");

      return { pass: true, reason: "Passed all filters" };
    }

    // if (buyEvent) {
    //   const isTarget = targets.find(
    //     (target) => target.address === buyEvent.user,
    //   );
    //   if (isTarget) {
    //     // postWalletTrack(buyEvent.user, isTarget.name, buyEvent.mint);
    //   }
    // }
    // if (!(createEvent && buyEvent))
    //   return { pass: false, reason: "createEvent or buyEvent not found" };
    // const tokenProgram =
    //   createEvent.type === "create_v2"
    //     ? TOKEN_2022_PROGRAM_ID
    //     : TOKEN_PROGRAM_ID;
    // const mintAccount = await getMint(
    //   connection,
    //   new PublicKey(createEvent.mint),
    //   "processed",
    //   tokenProgram,
    // );

    // // postToken(createEvent);
  } catch (err) {
    console.error(err);
  }
}

module.exports = { filterParsedTxData };
