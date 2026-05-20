import { createPublicClient, http, parseAbi, formatUnits } from "viem";

const client = createPublicClient({
  transport: http("https://rpc.testnet.arc.network"),
});
const USDC = "0x3600000000000000000000000000000000000000";
const EXCHANGE = "0xACC7D7441d869080EFf853E4edF6A836C49172Fb";
const USER = "0x6D183A6c0c37A13B3Db5C159795cC10F23b2E75D";
const abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
]);

const [bal, allow] = await Promise.all([
  client.readContract({ address: USDC, abi, functionName: "balanceOf", args: [USER] }),
  client.readContract({ address: USDC, abi, functionName: "allowance", args: [USER, EXCHANGE] }),
]);
console.log(`user:      ${USER}`);
console.log(`USDC bal:  ${formatUnits(bal, 6)}`);
console.log(`allowance: ${formatUnits(allow, 6)} (to Exchange)`);
