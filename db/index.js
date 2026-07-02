require("dotenv").config();
const pg = require("pg");

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DB_URL,
});

async function query(text, params) {
  return pool.query(text, params);
}

async function testDatabaseConnection() {
  const res = await pool.query("SELECT NOW()");
  console.log("DB connnected:", res.rows[0].now);
}

// ===== wallet track =====
async function createWalletTrackTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS wallet_track (
      wallet VARCHAR(255) NOT NULL,
      rename VARCHAR(255),
      mint VARCHAR(255) NOT NULL
    );
  `;

  await pool.query(sql);
}

async function postWalletTrack(wallet, rename, mint) {
  await createWalletTrackTable();

  const sql = `
    INSERT INTO wallet_track (wallet, rename, mint)
    VALUES ($1, $2, $3);
  `;

  await pool.query(sql, [wallet, rename ?? null, mint]);
}

// ===== tokens =====
async function createTokensTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS tokens (
      mint VARCHAR(255) NOT NULL,
      type VARCHAR(255) NOT NULL,
      bondingCurve VARCHAR(255) NOT NULL,
      "user" VARCHAR(255) NOT NULL,
      creator VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      symbol VARCHAR(255) NOT NULL,
      uri VARCHAR(255) NOT NULL,
      signature VARCHAR(255) NOT NULL,
      slot VARCHAR(255) NOT NULL,
      timestamp BIGINT NOT NULL,
      virtualTokenReserves VARCHAR(255) NOT NULL,
      virtualSolReserves VARCHAR(255) NOT NULL,
      realTokenReserves VARCHAR(255) NOT NULL,
      tokenTotalSupply VARCHAR(255) NOT NULL,
      tokenProgram VARCHAR(255) NOT NULL,
      isMayhemMode VARCHAR(255) NOT NULL,
      isCashbackEnabled VARCHAR(255) NOT NULL,
      quoteMint VARCHAR(255) NOT NULL,
      virtualQuoteReserves VARCHAR(255) NOT NULL,
      decimals SMALLINT NOT NULL,
      supply VARCHAR(255) NOT NULL,
      mintAuthority VARCHAR(255),
      freezeAuthority VARCHAR(255),
      isInitialized VARCHAR(255) NOT NULL,
      metadata TEXT NOT NULL
    )
  `;

  await pool.query(sql);
}

async function postToken(data) {
  await createTokensTable();

  const sql = `
    INSERT INTO tokens (mint, type, bondingCurve, "user", creator, name, symbol, uri, signature, slot, timestamp, virtualTokenReserves, virtualSolReserves, realTokenReserves, tokenTotalSupply, tokenProgram, isMayhemMode, isCashbackEnabled, quoteMint, virtualQuoteReserves, decimals, supply, mintAuthority, freezeAuthority, isInitialized, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26);
  `;

  await pool.query(sql, [
    data.mint,
    data.type,
    data.bondingCurve,
    data.user,
    data.creator,
    data.name,
    data.symbol,
    data.uri,
    data.signature,
    data.slot,
    data.timestamp,
    data.virtualTokenReserves,
    data.virtualSolReserves,
    data.realTokenReserves,
    data.tokenTotalSupply,
    data.tokenProgram,
    data.isMayhemMode,
    data.isCashbackEnabled,
    data.quoteMint,
    data.virtualQuoteReserves,
    data.mintInfo.decimals,
    data.mintInfo.supply,
    data.mintInfo.mintAuthority,
    data.mintInfo.freezeAuthority,
    data.mintInfo.isInitialized,
    JSON.stringify(data.metadata),
  ]);
}

module.exports = {
  query,
  testDatabaseConnection,
  createWalletTrackTable,
  postWalletTrack,
  createTokensTable,
  postToken,
};
