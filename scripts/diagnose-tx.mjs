import { createPublicClient, http, parseAbi, formatUnits, getAddress } from "viem";

const client = createPublicClient({
  transport: http("https://rpc.testnet.arc.network"),
});

const TX = "0x10302f643c2cd782b405289b20672d481149d6803655e095d5aafa801235035f";
const USDC = "0x3600000000000000000000000000000000000000";
const EXCHANGE = "0xACC7D7441d869080EFf853E4edF6A836C49172Fb";
const MARKET = "0x8F84A5a63667013e53ae37c885B57D77c77B25Af";
const MM = "0xB34320441203505B78B04b89Fe39Bc87256Bb09E";
const USER = "0x6D183A6c0c37A13B3Db5C159795cC10F23b2E75D";
const OUTCOME_TOKEN = "0x9c48BD5eCee82AB078534EfAa0c11F00b3f7e204";
const ORDER_PRICE_MICROS = 520000n;
const FILL_SIZE_MICROS = 200000n;
const REQUIRED_USDC = (ORDER_PRICE_MICROS * FILL_SIZE_MICROS) / 1_000_000n;

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
]);
const marketAbi = parseAbi([
  "function resolved() view returns (bool)",
  "function closesAt() view returns (uint64)",
  "function winningOutcome() view returns (uint8)",
]);
const erc1155Abi = parseAbi([
  "function balanceOf(address,uint256) view returns (uint256)",
  "function isApprovedForAll(address,address) view returns (bool)",
]);

const tx = await client.getTransaction({ hash: TX });
const receipt = await client.getTransactionReceipt({ hash: TX });
const block = await client.getBlock({ blockNumber: tx.blockNumber });
const blockTs = Number(block.timestamp);

console.log("=== Tx timeline ===");
console.log(`block:      ${tx.blockNumber}`);
console.log(`block ts:   ${new Date(blockTs * 1000).toISOString()}`);
console.log(`status:     ${receipt.status}`);
console.log(`gasUsed:    ${receipt.gasUsed}`);
console.log();

console.log("=== Order info ===");
console.log(`order expiry: 1779296254 (${new Date(1779296254 * 1000).toISOString()})`);
console.log(`expired at block ts? ${blockTs >= 1779296254 ? "YES — expired BEFORE fill" : "no, still valid"}`);
console.log(`required USDC: ${formatUnits(REQUIRED_USDC, 6)}`);
console.log();

console.log("=== Market state (now) ===");
const [resolved, closesAt] = await Promise.all([
  client.readContract({ address: MARKET, abi: marketAbi, functionName: "resolved" }),
  client.readContract({ address: MARKET, abi: marketAbi, functionName: "closesAt" }),
]);
console.log(`market addr:  ${MARKET}`);
console.log(`resolved:     ${resolved}`);
console.log(`closesAt:     ${closesAt} (${new Date(Number(closesAt) * 1000).toISOString()})`);
if (resolved) {
  const wo = await client.readContract({ address: MARKET, abi: marketAbi, functionName: "winningOutcome" });
  console.log(`winningOutcome: ${wo} (${wo === 1 ? "YES" : "NO"})`);
}
console.log(`block-ts vs closesAt: ${blockTs < Number(closesAt) ? "still open" : "ALREADY CLOSED at tx time"}`);
console.log();

console.log("=== User state at block ===");
const [userBalAt, allowAt] = await Promise.all([
  client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [USER], blockNumber: tx.blockNumber - 1n }),
  client.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [USER, EXCHANGE], blockNumber: tx.blockNumber - 1n }),
]);
console.log(`user USDC bal (block-1):  ${formatUnits(userBalAt, 6)}`);
console.log(`user allowance (block-1): ${formatUnits(allowAt, 6)}`);
console.log();

console.log("=== MM state at block ===");
// MM is seller; needs to deliver NO shares (outcome=0) to user
// tokenId = keccak256(abi.encode(market, outcome=0))
const { encodeAbiParameters, keccak256 } = await import("viem");
const noTokenId = BigInt(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint8" }], [getAddress(MARKET), 0])));
const [mmShares, mmApproved] = await Promise.all([
  client.readContract({ address: OUTCOME_TOKEN, abi: erc1155Abi, functionName: "balanceOf", args: [MM, noTokenId], blockNumber: tx.blockNumber - 1n }),
  client.readContract({ address: OUTCOME_TOKEN, abi: erc1155Abi, functionName: "isApprovedForAll", args: [MM, EXCHANGE], blockNumber: tx.blockNumber - 1n }),
]);
console.log(`MM NO shares (block-1): ${formatUnits(mmShares, 6)}`);
console.log(`MM 1155 approved Exchange: ${mmApproved}`);
console.log(`needed fillSize: ${formatUnits(FILL_SIZE_MICROS, 6)}`);
console.log();

console.log("=== Diagnosis ===");
if (blockTs >= 1779296254) {
  console.log("Order EXPIRED before tx landed → expected revert reason: 'Exchange: expired'");
}
if (blockTs >= Number(closesAt)) {
  console.log("Market CLOSED before tx landed → expected revert reason: 'Exchange: market closed'");
}
if (mmShares < FILL_SIZE_MICROS) {
  console.log(`MM short on NO shares (${formatUnits(mmShares, 6)} < ${formatUnits(FILL_SIZE_MICROS, 6)}) → 'OutcomeToken: insufficient'`);
}
if (!mmApproved) {
  console.log("MM has not approved Exchange on OutcomeToken → safeTransferFrom revert");
}
if (userBalAt < REQUIRED_USDC) {
  console.log(`User short USDC at tx time (${formatUnits(userBalAt, 6)} < ${formatUnits(REQUIRED_USDC, 6)})`);
}
if (allowAt < REQUIRED_USDC) {
  console.log(`User USDC allowance short at tx time (${formatUnits(allowAt, 6)} < ${formatUnits(REQUIRED_USDC, 6)})`);
}
