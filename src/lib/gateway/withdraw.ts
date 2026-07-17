import type { Address } from "viem";
import type { EthereumProvider } from "../onchain.js";
import { transferViaGateway, type GatewayTransferResult } from "./transfer.js";

/**
 * Withdraw = a Gateway transfer to your own address. The USDC leaves the
 * unified balance and lands back in the wallet on Arc in under a second.
 *
 * Circle also offers a trustless exit (GatewayWallet.initiateWithdrawal →
 * 7-day delay → withdraw()) that works even if Circle's API is down. That
 * path is deliberately not implemented yet: it is the censorship-resistance
 * escape hatch, not a withdraw button, and its ABI has not been proven on
 * Arc by our spike. Surface it later behind "Advanced".
 */
export async function withdrawFromGateway(
  provider: EthereumProvider,
  account: Address,
  amount: bigint,
  maxFee?: bigint
): Promise<GatewayTransferResult> {
  return transferViaGateway(provider, account, { recipient: account, amount, maxFee });
}
