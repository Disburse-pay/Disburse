import { createPublicClient, http } from "viem";

const client = createPublicClient({
  transport: http("https://rpc.testnet.arc.network"),
});

const TX = "0x10302f643c2cd782b405289b20672d481149d6803655e095d5aafa801235035f";
const tx = await client.getTransaction({ hash: TX });

console.log("trying eth_call at block", tx.blockNumber - 1n, "(pre-tx state)");
try {
  const res = await client.call({
    account: tx.from,
    to: tx.to,
    data: tx.input,
    value: tx.value,
    blockNumber: tx.blockNumber - 1n,
  });
  console.log("succeeded (would have worked!):", res);
} catch (err) {
  console.log("reverted:", err.cause?.shortMessage || err.shortMessage);
  console.log("data:", err.cause?.data || err.data || "(none)");
}

console.log();
console.log("trying eth_call at block", tx.blockNumber, "(post-tx state, same as before)");
try {
  await client.call({
    account: tx.from,
    to: tx.to,
    data: tx.input,
    value: tx.value,
    blockNumber: tx.blockNumber,
  });
} catch (err) {
  console.log("reverted:", err.cause?.shortMessage || err.shortMessage);
  console.log("data:", err.cause?.data || err.data || "(none)");
}

console.log();
console.log("trying eth_call at LATEST block (order is now long-expired):");
try {
  await client.call({
    account: tx.from,
    to: tx.to,
    data: tx.input,
    value: tx.value,
  });
} catch (err) {
  console.log("reverted:", err.cause?.shortMessage || err.shortMessage);
  console.log("data:", err.cause?.data || err.data || "(none)");
}
