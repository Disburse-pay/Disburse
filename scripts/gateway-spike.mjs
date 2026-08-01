// Phase 0 spike: prove Circle Gateway works on Arc testnet.
// Read-only balance checks use a public address. Mutating commands are dry-run
// by default and require --yes plus an environment-injected private key.

import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  formatUnits,
  getAddress,
  isAddress,
  pad
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "https://rpc.blockdaemon.testnet.arc.network";
const API = "https://gateway-api-testnet.circle.com/v1";
const ARC_DOMAIN = 26;
const GATEWAY_WALLET = getAddress("0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
const GATEWAY_MINTER = getAddress("0x0022222ABE238Cc2C7Bb1f21003F0a260052475B");
const USDC = getAddress("0x3600000000000000000000000000000000000000");
const MUTATING_STEPS = new Set(["deposit", "transfer"]);
const SUPPORTED_STEPS = new Set(["balance", ...MUTATING_STEPS]);

// Arc: legacy gas only (no EIP-1559), 20 gwei floor per the Disburse repo.
const arc = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } }
});

const pub = createPublicClient({ chain: arc, transport: http(RPC, { timeout: 20_000 }) });

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)"
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

async function apiBalance(address) {
  const r = await fetch(`${API}/balances`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "USDC", sources: [{ domain: ARC_DOMAIN, depositor: address }] })
  });
  const data = await r.json();
  return data?.balances?.[0] ?? data;
}

async function stepBalance(address) {
  const [native, token] = await Promise.all([
    pub.getBalance({ address }),
    pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [address] })
  ]);
  console.log("account          :", address);
  console.log("native USDC(18)  :", formatUnits(native, 18));
  console.log("ERC20 USDC(6)    :", formatUnits(token, 6));
  console.log("gateway balance  :", j(await apiBalance(address)));
}

async function stepDeposit(account, wallet) {
  const amount = 1_000000n; // 1 USDC
  await stepBalance(account.address);

  const allowance = await pub.readContract({
    address: USDC,
    abi: erc20,
    functionName: "allowance",
    args: [account.address, GATEWAY_WALLET]
  });
  console.log("\nallowance        :", formatUnits(allowance, 6));

  const gp = await gasPrice();
  if (allowance < amount) {
    console.log("approving 1 USDC to GatewayWallet…");
    const h = await wallet.writeContract({
      address: USDC,
      abi: erc20,
      functionName: "approve",
      args: [GATEWAY_WALLET, amount],
      gasPrice: gp
    });
    console.log("approve tx       :", h);
    const r = await pub.waitForTransactionReceipt({ hash: h });
    console.log("approve status   :", r.status);
  }

  console.log("\ndepositing 1 USDC into GatewayWallet…");
  const h = await wallet.writeContract({
    address: GATEWAY_WALLET,
    abi: gatewayWalletAbi,
    functionName: "deposit",
    args: [USDC, amount],
    gasPrice: gp
  });
  console.log("deposit tx       :", h);
  const r = await pub.waitForTransactionReceipt({ hash: h });
  console.log("deposit status   :", r.status, "| gas used:", r.gasUsed);
  console.log("explorer         : https://testnet.arcscan.app/tx/" + h);

  // Arc attests in ~0.5s per Circle docs; poll briefly.
  console.log("\npolling /v1/balances for the unified balance…");
  for (let i = 0; i < 20; i++) {
    const b = await apiBalance(account.address);
    console.log(`  t+${i}s ->`, j(b));
    // NOTE: /v1/balances returns a DECIMAL string ("1.000000"), not base units.
    if (Number(b?.balance ?? "0") > 0) {
      console.log("\n*** UNIFIED BALANCE CREDITED ***");
      break;
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
}

async function stepTransfer(account, wallet) {
  const value = 500000n; // 0.5 USDC back to self == the "instant withdraw" path
  const before = await apiBalance(account.address);
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
    hookData: "0x"
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
      { name: "hookData", type: "bytes" }
    ],
    BurnIntent: [
      { name: "maxBlockHeight", type: "uint256" },
      { name: "maxFee", type: "uint256" },
      { name: "spec", type: "TransferSpec" }
    ]
  };

  const signature = await account.signTypedData({
    domain: { name: "GatewayWallet", version: "1" },
    types,
    primaryType: "BurnIntent",
    message: burnIntent
  });
  console.log("burn intent signed.");

  const res = await fetch(`${API}/transfer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: j([{ burnIntent, signature }])
  });
  const text = await res.text();
  console.log("POST /v1/transfer ->", res.status);
  if (!res.ok) {
    console.log("body:", text.slice(0, 600));
    return;
  }
  const out = JSON.parse(text);
  const attestation = out.attestation ?? out.transfer?.attestation;
  const opSig = out.signature ?? out.transfer?.signature;
  console.log("attestation bytes :", attestation?.slice(0, 40) + "…");

  const gp = await gasPrice();
  const h = await wallet.writeContract({
    address: GATEWAY_MINTER,
    abi: gatewayMinterAbi,
    functionName: "gatewayMint",
    args: [attestation, opSig],
    gasPrice: gp
  });
  console.log("gatewayMint tx    :", h);
  const r = await pub.waitForTransactionReceipt({ hash: h });
  console.log("mint status       :", r.status);
  console.log("explorer          : https://testnet.arcscan.app/tx/" + h);
  console.log("\ngateway balance after:", j(await apiBalance(account.address)));
}

function printHelp() {
  console.log(`Usage: node scripts/gateway-spike.mjs [command] [options]

Commands:
  balance                 Read balances for a public address (default).
  deposit                 Plan a 1 USDC Gateway deposit.
  transfer                Plan a 0.5 USDC self-transfer.

Options:
  --address <address>      Public address to inspect or verify before broadcast.
  --dry-run                Print the mutating plan without reading a key.
  --yes                    Broadcast a mutating command.
  -h, --help               Show this help.

Environment:
  GATEWAY_SPIKE_ADDRESS      Public address used when --address is omitted.
  GATEWAY_SPIKE_PRIVATE_KEY  Required only with deposit/transfer --yes.

Safety:
  deposit and transfer are dry-run by default. Private keys are accepted only
  through GATEWAY_SPIKE_PRIVATE_KEY; command-line private-key flags are rejected.
  Inject the key from a scoped secret store before using --yes.`);
}

function parseArguments(argv) {
  const options = {
    address: undefined,
    dryRun: false,
    help: false,
    step: "balance",
    yes: false
  };
  let sawStep = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (/^--?(?:private-?key|key)(?:=|$)/i.test(arg)) {
      throw new Error("private keys are not accepted on the command line; use GATEWAY_SPIKE_PRIVATE_KEY");
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--yes") {
      options.yes = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--address") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) throw new Error("--address requires a value");
      options.address = value;
    } else if (arg.startsWith("--address=")) {
      options.address = arg.slice("--address=".length);
      if (!options.address) throw new Error("--address requires a value");
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    } else if (sawStep) {
      throw new Error(`unexpected argument: ${arg}`);
    } else {
      options.step = arg;
      sawStep = true;
    }
  }

  if (!options.help && !SUPPORTED_STEPS.has(options.step)) {
    throw new Error(`unknown command: ${options.step}`);
  }
  if (options.yes && options.dryRun) {
    throw new Error("--yes and --dry-run cannot be used together");
  }
  if (options.step === "balance" && options.yes) {
    throw new Error("--yes is only valid for deposit and transfer");
  }
  if (options.step === "balance" && options.dryRun) {
    throw new Error("--dry-run is only valid for deposit and transfer");
  }

  return options;
}

function configuredAddress(cliAddress) {
  const value = cliAddress ?? process.env.GATEWAY_SPIKE_ADDRESS;
  if (!value) return undefined;
  if (!isAddress(value)) {
    throw new Error("address must be a valid EVM address");
  }
  return getAddress(value);
}

function loadBroadcastAccount() {
  const privateKey = process.env.GATEWAY_SPIKE_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("GATEWAY_SPIKE_PRIVATE_KEY is required to broadcast");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("GATEWAY_SPIKE_PRIVATE_KEY must be a 32-byte hex private key");
  }
  return privateKeyToAccount(privateKey);
}

function printDryRun(step, address) {
  console.log(`DRY RUN: ${step}`);
  if (address) console.log("account          :", address);
  if (step === "deposit") {
    console.log("plan             : approve if needed, then deposit 1 USDC into GatewayWallet");
  } else {
    console.log("plan             : sign a 0.5 USDC burn intent, request attestation, then gatewayMint");
  }
  console.log("result           : no key read, no network request made, no transaction broadcast");
  console.log(`broadcast        : rerun with --yes after injecting GATEWAY_SPIKE_PRIVATE_KEY`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const address = configuredAddress(options.address);
  if (options.step === "balance") {
    if (!address) {
      throw new Error("balance requires --address or GATEWAY_SPIKE_ADDRESS");
    }
    await stepBalance(address);
    return;
  }

  if (!MUTATING_STEPS.has(options.step)) {
    throw new Error(`unsupported mutating command: ${options.step}`);
  }
  if (!options.yes) {
    printDryRun(options.step, address);
    return;
  }

  const account = loadBroadcastAccount();
  if (address && address !== account.address) {
    throw new Error("configured address does not match GATEWAY_SPIKE_PRIVATE_KEY");
  }
  const wallet = createWalletClient({
    account,
    chain: arc,
    transport: http(RPC, { timeout: 20_000 })
  });

  if (options.step === "deposit") await stepDeposit(account, wallet);
  else await stepTransfer(account, wallet);
}

main().catch((error) => {
  console.error("error:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
