import { getAddress, type Address } from "viem";
import type { EthereumProvider } from "./onchain";

/**
 * Re-read the signing provider immediately before an account-scoped wallet
 * operation. Rendered React state is advisory; `eth_accounts` is authoritative
 * for which wallet will actually sign.
 */
export async function assertProviderAccount(
  provider: EthereumProvider,
  expectedAccount: Address
): Promise<void> {
  let accounts: unknown;
  try {
    accounts = await provider.request({ method: "eth_accounts" });
  } catch {
    throw new Error("The connected wallet account could not be verified.");
  }

  const [first] = Array.isArray(accounts) ? accounts : [];
  let actualAccount: Address;
  try {
    actualAccount = getAddress(typeof first === "string" ? first : "");
  } catch {
    throw new Error("The connected wallet account could not be verified.");
  }

  if (actualAccount.toLowerCase() !== expectedAccount.toLowerCase()) {
    throw new Error("The connected wallet account changed. Review the operation again.");
  }
}
