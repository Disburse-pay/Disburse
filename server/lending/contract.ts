/**
 * Lending contract addresses + ABI. Reads addresses from env so the indexer
 * and API handlers don't need to load the deployment artifact at runtime.
 */
import { getAddress, parseAbi, type Address } from "viem";
import { HttpError } from "../http.js";

function readAddress(name: string): Address {
  const v = process.env[name]?.trim();
  if (!v) throw new HttpError(503, `Missing env: ${name}`);
  try {
    return getAddress(v);
  } catch {
    throw new HttpError(503, `Invalid address in env: ${name}`);
  }
}

export function lendingAddresses() {
  return {
    pool: readAddress("LENDING_POOL"),
    aToken: readAddress("LENDING_ATOKEN"),
    irm: readAddress("LENDING_IRM"),
    priceAdapter: readAddress("LENDING_PRICE_ADAPTER"),
    cirBtc: readAddress("LENDING_CIRBTC_ADDRESS"),
    usdc: readAddress("LENDING_USDC_ADDRESS"),
    pyth: readAddress("LENDING_PYTH_ADDRESS"),
  };
}

export function lendingPythFeed(): `0x${string}` {
  const v = process.env.LENDING_PYTH_BTC_USD_FEED?.trim();
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) {
    throw new HttpError(503, "LENDING_PYTH_BTC_USD_FEED must be a 32-byte hex string");
  }
  return v as `0x${string}`;
}

/**
 * Full ABI for the LendingPool — events used by the indexer + view functions
 * used by the API. Mirrors contracts/src/lending/LendingPool.sol.
 */
export const LENDING_POOL_ABI = parseAbi([
  // Events
  "event Deposited(address indexed user, uint256 usdcAmount, uint256 sharesMinted)",
  "event Withdrew(address indexed user, uint256 sharesBurned, uint256 usdcAmount)",
  "event CollateralDeposited(address indexed user, uint256 cirBtcAmount)",
  "event CollateralWithdrew(address indexed user, uint256 cirBtcAmount)",
  "event Borrowed(address indexed user, uint256 usdcAmount)",
  "event Repaid(address indexed payer, address indexed user, uint256 usdcAmount)",
  "event Liquidated(address indexed liquidator, address indexed borrower, uint256 usdcRepaid, uint256 cirBtcSeized, uint256 bonusBtc)",
  "event InterestAccrued(uint256 dt, uint256 newBorrowIndex, uint256 newSupplyIndex, uint256 reservesAdded)",
  "event ReservesWithdrawn(address indexed to, uint256 amount)",

  // Views — pool-wide
  "function availableCash() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function totalReserves() view returns (uint256)",
  "function supplyIndex() view returns (uint256)",
  "function borrowIndex() view returns (uint256)",
  "function lastAccrualTime() view returns (uint256)",

  // Views — per-user
  "function collateral(address user) view returns (uint256)",
  "function scaledBorrow(address user) view returns (uint256)",
  "function userDebtUsdc(address user) view returns (uint256)",
  "function collateralValueUsdc(address user) view returns (uint256)",
  "function healthFactor(address user) view returns (uint256)",
  "function maxBorrow(address user) view returns (uint256)",

  // Mutations (for keeper + UI)
  "function deposit(uint256 usdcAmount)",
  "function withdraw(uint256 shares)",
  "function depositCollateral(uint256 cirBtcAmount)",
  "function withdrawCollateral(uint256 cirBtcAmount)",
  "function borrow(uint256 usdcAmount)",
  "function repay(address user, uint256 usdcAmount)",
  "function liquidate(address borrower, uint256 repayUsdc)",
]);

export const IRM_ABI = parseAbi([
  "function getBorrowRatePerYear(uint256 cash, uint256 borrows, uint256 reserves) view returns (uint256)",
  "function getSupplyRatePerYear(uint256 cash, uint256 borrows, uint256 reserves, uint256 reserveFactorBps) view returns (uint256)",
  "function utilization(uint256 cash, uint256 borrows, uint256 reserves) view returns (uint256)",
]);

export const PRICE_ADAPTER_ABI = parseAbi([
  "function getPrice() view returns (uint256)",
  "function getPriceWithMeta() view returns (uint256 price, uint256 publishTime)",
  "function haircutBps() view returns (uint256)",
  "function maxAgeSeconds() view returns (uint256)",
]);

export const PYTH_ABI = parseAbi([
  "function getUpdateFee(bytes[] updateData) view returns (uint256)",
  "function updatePriceFeeds(bytes[] updateData) payable",
]);

export const ATOKEN_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

/// Reserve factor used by the contract (1000 bps = 10%). Mirrored here so
/// the IRM supply-rate calculation matches what the pool actually does.
export const LENDING_RESERVE_FACTOR_BPS = 1000n;

/// 1e18 fixed-point unit.
export const WAD = 10n ** 18n;
