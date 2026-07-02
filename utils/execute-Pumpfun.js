require("dotenv").config();
const bs58 = require("bs58");
const BN = require("bn.js");
const { Buffer } = require("buffer");

const {
  Connection,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
  Keypair,
} = require("@solana/web3.js");

const {
  getAssociatedTokenAddressSync,
  getAccount,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");

const PUMP_PROGRAM_ID = new PublicKey(process.env.PUMPFUN_PROGRAM_ID);

const wallet = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));

function getBondingCurve(mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()],
    PUMP_PROGRAM_ID,
  )[0];
}

function getGlobal() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM_ID,
  )[0];
}

const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

async function detectTokenProgram(connection, mint) {
  const info = await connection.getAccountInfo(mint);

  if (!info) {
    throw new Error("Mint not found");
  }

  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return TOKEN_2022_PROGRAM_ID;
  }

  return TOKEN_PROGRAM_ID;
}

function encodeBuy(amount, maxSolCost) {
  const data = Buffer.alloc(8 + 8 + 8);
  BUY_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(BigInt(amount ?? 0), 8); // token amount (raw units)
  data.writeBigUInt64LE(BigInt(maxSolCost), 16); // lamports max SOL

  return data;
}

function encodeSell(amount, minSolOut) {
  const data = Buffer.alloc(8 + 8 + 8);

  SELL_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(BigInt(amount), 8); // token amount
  data.writeBigUInt64LE(BigInt(minSolOut ?? 0), 16); // slippage protection

  return data;
}

async function getOrCreateATA(connection, mint, owner, type) {
  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    type === "create_v2" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  try {
    const account = await getAccount(connection, ata);

    if (!account || !account.owner.equals(TOKEN_PROGRAM_ID)) {
      throw new Error("Invalid ATA owner");
    }

    console.log("ATA valid");
    return { ata, createIx: null };
  } catch (e) {
    console.log("ATA missing/closed → recreate");
    const createIx = createAssociatedTokenAccountInstruction(
      owner, // payer
      ata,
      owner,
      mint,
      type === "create_v2" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    return { ata, createIx };
  }
}

// Main Buy instruction builder
async function builderPumpFunBuyIx(
  connection,
  type,
  {
    buyer, // PublicKey
    mint, // PublicKey
    amount, // token amount (in raw units)
    maxSolCost, // lamports
  },
) {
  const bondingCurve = getBondingCurve(mint);
  const global = getGlobal();

  const { ata, createIx: createAtaIx } = await getOrCreateATA(
    connection,
    new PublicKey(mint),
    buyer,
    type,
  );

  const data = encodeBuy(amount, maxSolCost);

  const keys = [
    // user
    { pubkey: buyer, isSigner: true, isWritable: true },
    // global state
    { pubkey: global, isSigner: false, isWritable: false },
    // bonding curve
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    // user token account (ATA)
    { pubkey: ata, isSigner: false, isWritable: true },
    // mint
    { pubkey: new PublicKey(mint), isSigner: false, isWritable: false },
    // system program
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const buyIx = new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys,
    data,
  });

  return { createAtaIx, buyIx };
}

async function builderPumpFunSellIx(
  connection,
  ata,
  { seller, mint, amount, minSolOut },
) {
  const bondingCurve = getBondingCurve(mint);
  const global = getGlobal();

  const data = encodeSell(amount, minSolOut);

  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      { pubkey: seller, isSigner: true, isWritable: true },
      { pubkey: global, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(mint), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// How to execute Buy
async function sendBuy(connection, ixs) {
  const tx = new Transaction();
  // Add Priority fee (CRITICAL)
  tx.add(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 300000,
    }),
  );
  // Set compute limit
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: 300000,
    }),
  );

  for (const ix of ixs) {
    if (ix) tx.add(ix);
  }

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  tx.sign(wallet);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
  });

  console.log("BUY TX:", sig);

  return sig;
}

async function buy(connection, mint, type, maxSolCost) {
  const { createAtaIx, buyIx } = await builderPumpFunBuyIx(connection, type, {
    buyer: wallet.publicKey,
    mint,
    maxSolCost,
  });

  await sendBuy(connection, [createAtaIx, buyIx]);
  console.log("Buy success!");
}

async function sell(connection, mint, amount) {
  const tokenProgram = await detectTokenProgram(
    connection,
    new PublicKey(mint),
  );

  const ata = getAssociatedTokenAddressSync(
    new PublicKey(mint),
    wallet.publicKey,
    false,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const bal = await connection.getTokenAccountBalance(ata);
  console.log(`${mint}: ${bal.value.amount}`);

  const sellIx = builderPumpFunSellIx(connection, ata, {
    seller: wallet.publicKey,
    mint,
    amount: bal.value.amount,
  });

  const tx = new Transaction();

  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 }));

  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));

  tx.add(sellIx);

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  tx.sign(wallet);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });

  console.log("SELL TX:", sig);

  return sig;
}

module.exports = { buy, sell };
