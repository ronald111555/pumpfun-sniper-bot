export function filterMintInfo(mintInfo) {
  const bc = mintInfo?.bondingCurve;

  // Safety filters
  if (mintInfo?.mintAuthority !== null)
    return { pass: false, reason: "Mint authority not renounced" };
  if (mintInfo?.freezeAuthority !== null)
    return { pass: false, reason: "Freeze authority exists" };
  if (bc?.complete === true) return { pass: false, reason: "Already migrated" };
  if (!bc) return { pass: false, reason: "Missing bonding curve data" };

  // Liquidity filters
  const realSOL = Number(bc?.realQuoteReserves) / 10 ** 9;
  if (realSOL < 3) return { pass: false, reason: "Liquidity too low (<3 SOL)" };
  if (realSOL > 200)
    return { pass: false, reason: "Liquidity too high (>200 SOL)" };

  // MarketCap filters
  if (bc?.marketCapSol < 5)
    return { pass: false, reason: "Too early / unstable MC" };
  if (bc?.marketCapSol > 150)
    return { pass: false, reason: "Already pumped too far" };

  // Pass
  return { pass: true, reason: "Passed all filters" };
}
