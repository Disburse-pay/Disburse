import { createPublicClient, http, decodeFunctionData, parseAbi, toHex, decodeAbiParameters } from "viem";

const client = createPublicClient({
  transport: http("https://rpc.testnet.arc.network"),
});

const TX = "0x10302f643c2cd782b405289b20672d481149d6803655e095d5aafa801235035f";
const tx = await client.getTransaction({ hash: TX });

// Re-execute the exact tx at the block it landed in to extract revert data.
try {
  await client.call({
    account: tx.from,
    to: tx.to,
    data: tx.input,
    value: tx.value,
    blockNumber: tx.blockNumber,
  });
  console.log("simulate succeeded (unexpected)");
} catch (err) {
  console.log("--- simulation error ---");
  console.log("name:", err.name);
  console.log("shortMessage:", err.shortMessage);
  console.log("details:", err.details);
  if (err.cause) {
    console.log("cause name:", err.cause.name);
    console.log("cause shortMessage:", err.cause.shortMessage);
    console.log("cause details:", err.cause.details);
    if (err.cause.data) {
      console.log("cause data:", err.cause.data);
    }
  }
  if (err.data) console.log("data:", err.data);
  // Try to decode the revert data as a string (Error(string) selector 0x08c379a0)
  const raw = err.cause?.data ?? err.data;
  if (raw && raw.startsWith("0x08c379a0")) {
    try {
      const decoded = decodeAbiParameters([{ type: "string" }], `0x${raw.slice(10)}`);
      console.log("decoded string:", decoded[0]);
    } catch (e) {
      console.log("decode failed:", e.message);
    }
  } else if (raw && raw === "0x") {
    console.log("decoded: <empty revert — could be require(false) without reason OR sub-call panic>");
  }
}
