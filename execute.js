import { Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

const inputMint = process.env.INPUT_MINT;
const baseUrl = process.env.JUPITER_BASE_URL;
const apiKey = process.env.JUPITER_API_KEY;

const wallet = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));

async function getOrder(outputMint, amount, slippageBps) {
  const url =
    `${baseUrl}/order?` +
    new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: slippageBps.toString(),
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

export async function execute(outputMint, amount, slippageBps) {
  try {
    console.log("Getting order...");
    const order = await getOrder(outputMint, amount, slippageBps);
    if (!order.transaction) {
      throw new Error("No transaction returned");
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
  } catch (err) {
    console.error(err);
  }
}
