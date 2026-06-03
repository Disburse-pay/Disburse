import { createPublicClient, http, parseAbi, getAddress } from "viem";

const client = createPublicClient({
  transport: http("https://rpc.testnet.arc.network"),
});

const TX = "0x10302f643c2cd782b405289b20672d481149d6803655e095d5aafa801235035f";
const USER = "0x6D183A6c0c37A13B3Db5C159795cC10F23b2E75D";
const MARKET = "0x8F84A5a63667013e53ae37c885B57D77c77B25Af";
const EXCHANGE = "0xACC7D7441d869080EFf853E4edF6A836C49172Fb";
const OUTCOME_TOKEN = "0x9c48BD5eCee82AB078534EfAa0c11F00b3f7e204";
const USDC = "0x3600000000000000000000000000000000000000";

const tx = await client.getTransaction({ hash: TX });

const userCode = await client.getBytecode({ address: USER });
const exchCode = await client.getBytecode({ address: EXCHANGE });
const usdcCode = await client.getBytecode({ address: USDC });
const otokCode = await client.getBytecode({ address: OUTCOME_TOKEN });

console.log("=== contract presence ===");
console.log(`user (${USER}): ${userCode ? `IS CONTRACT (${userCode.length} bytes)` : "EOA"}`);
console.log(`exchange:       ${exchCode ? `contract (${exchCode.length} bytes)` : "MISSING"}`);
console.log(`usdc:           ${usdcCode ? `contract (${usdcCode.length} bytes)` : "MISSING"}`);
console.log(`outcomeToken:   ${otokCode ? `contract (${otokCode.length} bytes)` : "MISSING"}`);
console.log();

// Try eth_call AGAIN but with debug_traceTransaction
console.log("=== try debug_traceTransaction ===");
try {
  const trace = await client.request({
    method: "debug_traceTransaction",
    params: [TX, { tracer: "callTracer" }],
  });
  console.log(JSON.stringify(trace, null, 2));
} catch (err) {
  console.log("debug_traceTransaction not available:", err.shortMessage || err.message);
}

// Inspect order tuple and signature
console.log();
console.log("=== order verification ===");
// Order from earlier decode
const order = {
  maker: getAddress("0xB34320441203505B78B04b89Fe39Bc87256Bb09E"),
  market: getAddress("0x8F84A5a63667013e53ae37c885B57D77c77B25Af"),
  outcome: 0,
  side: 1,
  price: 520000n,
  size: 1000000n,
  expiry: 1779296254n,
  salt: 99234746762849811675693178006273724518500959075930552079535071940934314193063n,
};

const exchAbi = parseAbi([
  "function hashOrder((address,address,uint8,uint8,uint256,uint256,uint64,uint256)) view returns (bytes32)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function ORDER_TYPEHASH() view returns (bytes32)",
  "function filled(bytes32) view returns (uint256)",
  "function cancelled(bytes32) view returns (bool)",
]);
const [hash, dom, th] = await Promise.all([
  client.readContract({ address: EXCHANGE, abi: exchAbi, functionName: "hashOrder", args: [[order.maker, order.market, order.outcome, order.side, order.price, order.size, order.expiry, order.salt]] }),
  client.readContract({ address: EXCHANGE, abi: exchAbi, functionName: "DOMAIN_SEPARATOR" }),
  client.readContract({ address: EXCHANGE, abi: exchAbi, functionName: "ORDER_TYPEHASH" }),
]);
console.log("DOMAIN_SEPARATOR:", dom);
console.log("ORDER_TYPEHASH: ", th);
console.log("order hash:     ", hash);

const [f, c] = await Promise.all([
  client.readContract({ address: EXCHANGE, abi: exchAbi, functionName: "filled", args: [hash] }),
  client.readContract({ address: EXCHANGE, abi: exchAbi, functionName: "cancelled", args: [hash] }),
]);
console.log("filled[hash]:   ", f.toString());
console.log("cancelled[hash]:", c);
