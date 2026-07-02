const { Keypair, VersionedTransaction } = require("@solana/web3.js");
const bs58 = require("bs58");

const baseUrl = process.env.JUPITER_BASE_URL;
const apiKey = process.env.JUPITER_API_KEY;

const wallet = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));

async function getOrder(
  inputMint,
  outputMint,
  amount,
  slippageBps,
  priorityFeeLamports,
  jitoTipLamports,
) {
  const url =
    `${baseUrl}/order?` +
    new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: slippageBps.toString(),
      priorityFeeLamports: priorityFeeLamports.toString(),
      jitoTipLamports: jitoTipLamports.toString(),
      taker: wallet.publicKey.toString(),
    });

  const res = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
    },
  });

  return await res.json();
}

async function signTransaction(order) {
  const txBuf = Buffer.from(order.transaction, "base64");
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([wallet]);

  return tx.serialize();
}

async function executeSwap(signedTx, requestId) {
  const res = await fetch(`${baseUrl}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      signedTransaction: Buffer.from(signedTx).toString("base64"),
      requestId,
    }),
  });

  return await res.json();
}

async function execute(
  inputMint,
  outputMint,
  amount,
  slippageBps,
  priorityFeeLamports,
  jitoTipLamports,
) {
  try {
    console.log("Getting order...");
    const order = await getOrder(
      inputMint,
      outputMint,
      amount,
      slippageBps,
      priorityFeeLamports,
      jitoTipLamports,
    );
    if (!order.transaction) {
      console.log(order.error);
      return;
    }
    console.log("Signing transaction...");
    const signedTx = await signTransaction(order);

    console.log("Executing...");
    console.log("requestId:", order.requestId);

    const result = await executeSwap(signedTx, order.requestId);
    console.log("Result:", result);

    if (result.status === "Success") {
      console.log("Swap successful:", result.signature);
      console.log("mint:", outputMint);
    } else {
      console.log("Swap failed:", result.error);
    }

    return result;
  } catch (err) {
    console.error(err);
  }
}

module.exports = { execute };
