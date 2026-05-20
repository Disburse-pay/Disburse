import { createPublicClient, http, decodeFunctionData } from "viem";

const client = createPublicClient({
  transport: http("https://rpc.testnet.arc.network"),
});

const TX = "0x10302f643c2cd782b405289b20672d481149d6803655e095d5aafa801235035f";

const FILL_ORDERS_ABI = [
  {
    type: "function",
    name: "fillOrders",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "orders",
        type: "tuple[]",
        components: [
          { name: "maker", type: "address" },
          { name: "market", type: "address" },
          { name: "outcome", type: "uint8" },
          { name: "side", type: "uint8" },
          { name: "price", type: "uint256" },
          { name: "size", type: "uint256" },
          { name: "expiry", type: "uint64" },
          { name: "salt", type: "uint256" }
        ]
      },
      { name: "signatures", type: "bytes[]" },
      { name: "fillSizes", type: "uint256[]" }
    ],
    outputs: []
  }
];

const tx = await client.getTransaction({ hash: TX });
console.log("from:    ", tx.from);
console.log("to:      ", tx.to);
console.log("value:   ", tx.value.toString());
console.log("blockNum:", tx.blockNumber);
console.log();
const decoded = decodeFunctionData({ abi: FILL_ORDERS_ABI, data: tx.input });
console.log("fn:", decoded.functionName);
const [orders, sigs, fillSizes] = decoded.args;
for (let i = 0; i < orders.length; i++) {
  const o = orders[i];
  console.log(`order[${i}]:`);
  console.log(`  maker:    ${o.maker}`);
  console.log(`  market:   ${o.market}`);
  console.log(`  outcome:  ${o.outcome} (${o.outcome === 1 ? "YES" : "NO"})`);
  console.log(`  side:     ${o.side} (${o.side === 1 ? "SELL" : "BUY"})`);
  console.log(`  price:    ${o.price} (${Number(o.price) / 1e6})`);
  console.log(`  size:     ${o.size} (${Number(o.size) / 1e6} shares)`);
  console.log(`  expiry:   ${o.expiry} (${new Date(Number(o.expiry) * 1000).toISOString()})`);
  console.log(`  salt:     ${o.salt}`);
  console.log(`  fillSize: ${fillSizes[i]} (${Number(fillSizes[i]) / 1e6} shares)`);
  console.log(`  totalUSDC: ${(Number(o.price) * Number(fillSizes[i])) / 1e12}`);
}
