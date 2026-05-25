/**
 * Browser-side wallet writes for the lending product.
 *
 * Every action is the same shape:
 *   1. Pyth pull-update if needed (only the price-sensitive paths)
 *   2. Ensure ERC20 allowance from user → LendingPool
 *   3. Encode + send the LendingPool tx via Dynamic provider
 *   4. Wait for receipt
 *
 * Pyth pull-update model: the user pays a tiny fee (~1 wei on Arc) to push
 * a fresh Hermes update so the contract has a non-stale price for the
 * upcoming op. We bundle this into the same UX action; in the failure case
 * the keeper bot's periodic push will cover within ~3 min.
 */
import {
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { ARC_CHAIN_ID, publicClient, TOKENS } from "../arc";
import type { EthereumProvider } from "../onchain";
import { getLendingConfig } from "./config";

const LENDING_POOL_ABI = parseAbi([
  "function deposit(uint256 usdcAmount)",
  "function withdraw(uint256 shares)",
  "function depositCollateral(uint256 cirBtcAmount)",
  "function withdrawCollateral(uint256 cirBtcAmount)",
  "function borrow(uint256 usdcAmount)",
  "function repay(address user, uint256 usdcAmount)",
  "function liquidate(address borrower, uint256 repayUsdc)",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

const PYTH_ABI = parseAbi([
  "function getUpdateFee(bytes[] updateData) view returns (uint256)",
  "function updatePriceFeeds(bytes[] updateData) payable",
]);

const MAX_UINT256 = (1n << 256n) - 1n;

// ─── Network guard ───────────────────────────────────────────────────────

async function assertOnArc(provider: EthereumProvider): Promise<void> {
  const raw = (await provider.request({ method: "eth_chainId" })) as unknown;
  const chainId = typeof raw === "string" ? parseInt(raw, 16) : Number(raw);
  if (chainId !== ARC_CHAIN_ID) {
    throw new Error("Wallet is not on Arc Testnet. Switch networks, then try again.");
  }
}

async function sendTx(
  provider: EthereumProvider,
  account: Address,
  to: Address,
  data: Hex,
  value: bigint = 0n
): Promise<Hash> {
  const params: Record<string, string> = { from: account, to, data };
  if (value > 0n) params.value = `0x${value.toString(16)}`;
  const hash = (await provider.request({
    method: "eth_sendTransaction",
    params: [params],
  })) as unknown;
  if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
    throw new Error("Wallet did not return a transaction hash.");
  }
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: hash as Hash,
    confirmations: 1,
  });
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted: ${hash}`);
  }
  return hash as Hash;
}

// ─── Allowances ──────────────────────────────────────────────────────────

async function ensureAllowance(
  provider: EthereumProvider,
  account: Address,
  token: Address,
  spender: Address,
  needed: bigint
): Promise<void> {
  const allowance = (await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account, spender],
  })) as bigint;
  if (allowance >= needed) return;
  await sendTx(
    provider,
    account,
    token,
    encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, MAX_UINT256] })
  );
}

// ─── Pyth update fetch + push ────────────────────────────────────────────

const HERMES_URL = "https://hermes.pyth.network";

/**
 * Fetch the latest BTC/USD update from Hermes and push it on-chain. Returns
 * silently if the fetch fails — keeper bot will catch up. Throws if the
 * push itself reverts (a more serious failure that should surface).
 */
export async function pushFreshPythUpdate(
  provider: EthereumProvider,
  account: Address
): Promise<void> {
  const cfg = getLendingConfig();
  let updateHex: Hex;
  try {
    const url = `${HERMES_URL}/v2/updates/price/latest?ids%5B%5D=${cfg.pythFeedId}&encoding=hex`;
    const res = await fetch(url);
    if (!res.ok) return;
    const body = (await res.json()) as { binary: { data: string[] } };
    updateHex = ("0x" + body.binary.data[0]) as Hex;
  } catch {
    return; // network blip — proceed without push; contract may revert if stale
  }

  const fee = (await publicClient.readContract({
    address: cfg.pyth,
    abi: PYTH_ABI,
    functionName: "getUpdateFee",
    args: [[updateHex]],
  })) as bigint;

  await sendTx(
    provider,
    account,
    cfg.pyth,
    encodeFunctionData({
      abi: PYTH_ABI,
      functionName: "updatePriceFeeds",
      args: [[updateHex]],
    }),
    fee
  );
}

// ─── Lending mutations ───────────────────────────────────────────────────

/** Supply USDC to the pool. Mints aUSDC shares to caller. */
export async function deposit(
  provider: EthereumProvider,
  account: Address,
  usdcAmount: bigint
): Promise<Hash> {
  await assertOnArc(provider);
  const cfg = getLendingConfig();
  await ensureAllowance(provider, account, TOKENS.USDC.address, cfg.pool, usdcAmount);
  return sendTx(
    provider,
    account,
    cfg.pool,
    encodeFunctionData({ abi: LENDING_POOL_ABI, functionName: "deposit", args: [usdcAmount] })
  );
}

/** Withdraw aUSDC shares for USDC + accrued interest. */
export async function withdraw(
  provider: EthereumProvider,
  account: Address,
  shares: bigint
): Promise<Hash> {
  await assertOnArc(provider);
  const cfg = getLendingConfig();
  return sendTx(
    provider,
    account,
    cfg.pool,
    encodeFunctionData({ abi: LENDING_POOL_ABI, functionName: "withdraw", args: [shares] })
  );
}

/** Deposit cirBTC as collateral. No price needed at this step. */
export async function depositCollateral(
  provider: EthereumProvider,
  account: Address,
  cirBtcAmount: bigint
): Promise<Hash> {
  await assertOnArc(provider);
  const cfg = getLendingConfig();
  await ensureAllowance(provider, account, cfg.cirBtc, cfg.pool, cirBtcAmount);
  return sendTx(
    provider,
    account,
    cfg.pool,
    encodeFunctionData({
      abi: LENDING_POOL_ABI,
      functionName: "depositCollateral",
      args: [cirBtcAmount],
    })
  );
}

/** Pull cirBTC back. Pool reverts if resulting HF < 1 → push Pyth first. */
export async function withdrawCollateral(
  provider: EthereumProvider,
  account: Address,
  cirBtcAmount: bigint
): Promise<Hash> {
  await assertOnArc(provider);
  await pushFreshPythUpdate(provider, account);
  const cfg = getLendingConfig();
  return sendTx(
    provider,
    account,
    cfg.pool,
    encodeFunctionData({
      abi: LENDING_POOL_ABI,
      functionName: "withdrawCollateral",
      args: [cirBtcAmount],
    })
  );
}

/** Borrow USDC against deposited cirBTC. Requires fresh price. */
export async function borrow(
  provider: EthereumProvider,
  account: Address,
  usdcAmount: bigint
): Promise<Hash> {
  await assertOnArc(provider);
  await pushFreshPythUpdate(provider, account);
  const cfg = getLendingConfig();
  return sendTx(
    provider,
    account,
    cfg.pool,
    encodeFunctionData({ abi: LENDING_POOL_ABI, functionName: "borrow", args: [usdcAmount] })
  );
}

/** Repay USDC debt for self (or another user). */
export async function repay(
  provider: EthereumProvider,
  account: Address,
  usdcAmount: bigint,
  forUser?: Address
): Promise<Hash> {
  await assertOnArc(provider);
  const cfg = getLendingConfig();
  await ensureAllowance(provider, account, TOKENS.USDC.address, cfg.pool, usdcAmount);
  return sendTx(
    provider,
    account,
    cfg.pool,
    encodeFunctionData({
      abi: LENDING_POOL_ABI,
      functionName: "repay",
      args: [forUser ?? account, usdcAmount],
    })
  );
}

// ─── Read helpers (live, bypass indexer cache) ───────────────────────────

const READ_ABI = parseAbi([
  "function maxBorrow(address user) view returns (uint256)",
  "function userDebtUsdc(address user) view returns (uint256)",
  "function collateral(address user) view returns (uint256)",
  "function balanceOf(address user) view returns (uint256)",
]);

export async function readMaxBorrow(user: Address): Promise<bigint> {
  const cfg = getLendingConfig();
  return (await publicClient.readContract({
    address: cfg.pool,
    abi: READ_ABI,
    functionName: "maxBorrow",
    args: [user],
  })) as bigint;
}

export async function readAUsdcBalance(user: Address): Promise<bigint> {
  const cfg = getLendingConfig();
  return (await publicClient.readContract({
    address: cfg.aToken,
    abi: READ_ABI,
    functionName: "balanceOf",
    args: [user],
  })) as bigint;
}

/** Wallet ERC20 balance for USDC. Used by the lending UI to populate MAX buttons. */
export async function readUsdcWalletBalance(user: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: TOKENS.USDC.address,
    abi: READ_ABI,
    functionName: "balanceOf",
    args: [user],
  })) as bigint;
}

/** Wallet ERC20 balance for cirBTC. Used to populate the "Deposit collateral" MAX. */
export async function readCirBtcWalletBalance(user: Address): Promise<bigint> {
  const cfg = getLendingConfig();
  return (await publicClient.readContract({
    address: cfg.cirBtc,
    abi: READ_ABI,
    functionName: "balanceOf",
    args: [user],
  })) as bigint;
}

/** Locked collateral inside the pool (separate from the user's wallet cirBTC). */
export async function readUserCollateral(user: Address): Promise<bigint> {
  const cfg = getLendingConfig();
  return (await publicClient.readContract({
    address: cfg.pool,
    abi: READ_ABI,
    functionName: "collateral",
    args: [user],
  })) as bigint;
}

/** Live USDC debt incl. accrued interest. Always > the indexer cache near tip. */
export async function readUserDebt(user: Address): Promise<bigint> {
  const cfg = getLendingConfig();
  return (await publicClient.readContract({
    address: cfg.pool,
    abi: READ_ABI,
    functionName: "userDebtUsdc",
    args: [user],
  })) as bigint;
}
