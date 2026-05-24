/**
 * Lending-side addresses for the browser. Vite bakes VITE_ vars into the
 * bundle at build time, so we read them once + cache.
 */
import { getAddress, type Address, type Hex } from "viem";

let cached: LendingConfig | undefined;

export type LendingConfig = {
  pool: Address;
  aToken: Address;
  cirBtc: Address;
  pyth: Address;
  pythFeedId: Hex;
};

export function getLendingConfig(): LendingConfig {
  if (cached) return cached;
  const pool = import.meta.env.VITE_LENDING_POOL?.trim();
  const aToken = import.meta.env.VITE_LENDING_ATOKEN?.trim();
  const cirBtc = import.meta.env.VITE_LENDING_CIRBTC?.trim();
  const pyth = import.meta.env.VITE_LENDING_PYTH_ADDRESS?.trim();
  const feed = import.meta.env.VITE_LENDING_PYTH_BTC_USD_FEED?.trim();
  if (!pool || !aToken || !cirBtc || !pyth || !feed) {
    throw new Error(
      "Lending env vars are missing — set VITE_LENDING_POOL, VITE_LENDING_ATOKEN, VITE_LENDING_CIRBTC, VITE_LENDING_PYTH_ADDRESS, VITE_LENDING_PYTH_BTC_USD_FEED"
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(feed)) {
    throw new Error("VITE_LENDING_PYTH_BTC_USD_FEED must be a 32-byte hex");
  }
  cached = {
    pool: getAddress(pool),
    aToken: getAddress(aToken),
    cirBtc: getAddress(cirBtc),
    pyth: getAddress(pyth),
    pythFeedId: feed as Hex,
  };
  return cached;
}
