// Phase 0 spike: prove Circle Gateway works on Arc testnet.
// Usage: node gateway-spike.mjs <step>   where step = deposit | balance | transfer
// Loads ONLY ARCADE_DEPLOYER_PRIVATE_KEY from D:/Arcade/.env.deploy.local.

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  createPublicClient, createWalletClient, defineChain, http,
  parseAbi, formatUnits, getAddress, pad,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "https://rpc.blockdaemon.testnet.arc.network";
const API = "https://gateway-api-testnet.circle.com/v1";
const ARC_DOMAIN = 26;
const GATEWAY_WALLET = getAddress("0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
const GATEWAY_MINTER = getAddress("0x0022222ABE238Cc2C7Bb1f21003F0a260052475B");
const USDC = getAddress("0x3600000000000000000000000000000000000000");

// Arc: legacy gas only (no EIP-1559), 20 gwei floor per the Disburse repo.
const arc = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

function loadKey() {
  const txt = readFileSync("D:/Arcade/.env.deploy.local", "utf8");
  const m = txt.match(/^ARCADE_DEPLOYER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m);
  if (!m) throw new Error("ARCADE_DEPLOYER_PRIVATE_KEY not found");
  return m[1];
}

const account = privateKeyToAccount(loadKey());
const pub = createPublicClient({ chain: arc, transport: http(RPC, { timeout: 20_000 }) });
const wallet = createWalletClient({ account, chain: arc, transport: http(RPC, { timeout: 20_000 }) });

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const gatewayWalletAbi = parseAbi(["function deposit(address token, uint256 value)"]);
const gatewayMinterAbi = parseAbi(["function gatewayMint(bytes attestationPayload, bytes signature)"]);

const b32 = (a) => pad(getAddress(a), { size: 32 });
const j = (o) => JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v));

async function gasPrice() {
  const g = await pub.getGasPrice();
  const floor = 20_000_000_000n;
  return g > floor ? g : floor;
}

async function apiBalance() {
  const r = await fetch(`${API}/balances`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "USDC", sources: [{ domain: ARC_DOMAIN, depositor: account.address }] }),
  });
  const data = await r.json();
  return data?.balances?.[0] ?? data;
}

async function stepBalance() {
  const [native, token] = await Promise.all([
    pub.getBalance({ address: account.address }),
    pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [account.address] }),
  ]);
  console.log("account          :", account.address);
  console.log("native USDC(18)  :", formatUnits(native, 18));
  console.log("ERC20 USDC(6)    :", formatUnits(token, 6));
  console.log("gateway balance  :", j(await apiBalance()));
}

async function stepDeposit() {
  const amount = 1_000000n; // 1 USDC
  await stepBalance();

  const allowance = await pub.readContract({
    address: USDC, abi: erc20, functionName: "allowance", args: [account.address, GATEWAY_WALLET],
  });
  console.log("\nallowance        :", formatUnits(allowance, 6));

  const gp = await gasPrice();
  if (allowance < amount) {
    console.log("approving 1 USDC to GatewayWallet…");
    const h = await wallet.writeContract({
      address: USDC, abi: erc20, functionName: "approve", args: [GATEWAY_WALLET, amount],
      gasPrice: gp,
    });
    console.log("approve tx       :", h);
    const r = await pub.waitForTransactionReceipt({ hash: h });
    console.log("approve status   :", r.status);
  }

  console.log("\ndepositing 1 USDC into GatewayWallet…");
  const h = await wallet.writeContract({
    address: GATEWAY_WALLET, abi: gatewayWalletAbi, functionName: "deposit", args: [USDC, amount],
    gasPrice: gp,
  });
  console.log("deposit tx       :", h);
  const r = await pub.waitForTransactionReceipt({ hash: h });
  console.log("deposit status   :", r.status, "| gas used:", r.gasUsed);
  console.log("explorer         : https://testnet.arcscan.app/tx/" + h);

  // Arc attests in ~0.5s per Circle docs; poll briefly.
  console.log("\npolling /v1/balances for the unified balance…");
  for (let i = 0; i < 20; i++) {
    const b = await apiBalance();
    console.log(`  t+${i}s ->`, j(b));
    // NOTE: /v1/balances returns a DECIMAL string ("1.000000"), not base units.
    if (Number(b?.balance ?? "0") > 0) { console.log("\n*** UNIFIED BALANCE CREDITED ***"); break; }
    await new Promise((res) => setTimeout(res, 1000));
  }
}

async function stepTransfer() {
  const value = 500000n; // 0.5 USDC back to self == the "instant withdraw" path
  const before = await apiBalance();
  console.log("gateway balance before:", j(before));

  const info = await (await fetch(`${API}/info`)).json();
  const arcInfo = info.domains.find((d) => d.domain === ARC_DOMAIN);
  // Arc mints sub-second blocks, so burnIntentExpirationHeight from /v1/info is
  // stale almost immediately — the API rejects it as "too low" within ~1s.
  // Add a buffer; the check is a minimum, not an exact match.
  const maxBlockHeight = BigInt(arcInfo.burnIntentExpirationHeight) + 10_000n;
  console.log("maxBlockHeight        :", maxBlockHeight);

  const spec = {
    version: 1,
    sourceDomain: ARC_DOMAIN,
    destinationDomain: ARC_DOMAIN, // same domain = instant withdraw
    sourceContract: b32(GATEWAY_WALLET),
    destinationContract: b32(GATEWAY_MINTER),
    sourceToken: b32(USDC),
    destinationToken: b32(USDC),
    sourceDepositor: b32(account.address),
    destinationRecipient: b32(account.address),
    sourceSigner: b32(account.address),
    destinationCaller: b32("0x0000000000000000000000000000000000000000"),
    value,
    salt: `0x${randomBytes(32).toString("hex")}`,
    hookData: "0x",
  };
  const burnIntent = { maxBlockHeight, maxFee: 100000n, spec }; // maxFee 0.1 USDC cap

  const types = {
    TransferSpec: [
      { name: "version", type: "uint32" },
      { name: "sourceDomain", type: "uint32" },
      { name: "destinationDomain", type: "uint32" },
      { name: "sourceContract", type: "bytes32" },
      { name: "destinationContract", type: "bytes32" },
      { name: "sourceToken", type: "bytes32" },
      { name: "destinationToken", type: "bytes32" },
      { name: "sourceDepositor", type: "bytes32" },
      { name: "destinationRecipient", type: "bytes32" },
      { name: "sourceSigner", type: "bytes32" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "value", type: "uint256" },
      { name: "salt", type: "bytes32" },
      { name: "hookData", type: "bytes" },
    ],
    BurnIntent: [
      { name: "maxBlockHeight", type: "uint256" },
      { name: "maxFee", type: "uint256" },
      { name: "spec", type: "TransferSpec" },
    ],
  };

  const signature = await account.signTypedData({
    domain: { name: "GatewayWallet", version: "1" },
    types, primaryType: "BurnIntent", message: burnIntent,
  });
  console.log("burn intent signed.");

  const res = await fetch(`${API}/transfer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: j([{ burnIntent, signature }]),
  });
  const text = await res.text();
  console.log("POST /v1/transfer ->", res.status);
  if (!res.ok) { console.log("body:", text.slice(0, 600)); return; }
  const out = JSON.parse(text);
  const attestation = out.attestation ?? out.transfer?.attestation;
  const opSig = out.signature ?? out.transfer?.signature;
  console.log("attestation bytes :", attestation?.slice(0, 40) + "…");

  const gp = await gasPrice();
  const h = await wallet.writeContract({
    address: GATEWAY_MINTER, abi: gatewayMinterAbi, functionName: "gatewayMint",
    args: [attestation, opSig], gasPrice: gp,
  });
  console.log("gatewayMint tx    :", h);
  const r = await pub.waitForTransactionReceipt({ hash: h });
  console.log("mint status       :", r.status);
  console.log("explorer          : https://testnet.arcscan.app/tx/" + h);
  console.log("\ngateway balance after:", j(await apiBalance()));
}

const step = process.argv[2] ?? "balance";
if (step === "balance") await stepBalance();
else if (step === "deposit") await stepDeposit();
else if (step === "transfer") await stepTransfer();
else console.log("unknown step");
