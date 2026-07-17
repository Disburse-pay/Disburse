import { encodeFunctionData, getAddress, numberToHex, type Address, type Hash } from "viem";
import { TOKENS, erc20Abi, publicClient } from "../arc.js";
import {
  readPendingNonce,
  requestWalletTransaction,
  waitForTransactionConfirmation,
  type EthereumProvider,
  type WalletTransferTransaction
} from "../onchain.js";
import { GATEWAY_WALLET_ADDRESS, gatewayWalletAbi } from "./types.js";

/**
 * Deposit USDC into the Gateway Wallet: approve (if needed) then deposit().
 *
 * ⚠️ NEVER send a plain ERC-20 transfer() to the Gateway Wallet — Circle's
 * docs are explicit that USDC sent that way is permanently lost. This module
 * is the only place the app talks to the Gateway Wallet, and it only ever
 * calls approve + deposit. Keep it that way.
 */

export type DepositResult = {
  approveHash?: Hash;
  depositHash: Hash;
};

export async function readGatewayAllowance(owner: Address): Promise<bigint> {
  return publicClient.readContract({
    address: TOKENS.USDC.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, GATEWAY_WALLET_ADDRESS]
  });
}

/**
 * Approve (only if the current allowance is short) and deposit `amount`
 * USDC base units into the Gateway Wallet. Waits for each transaction to
 * confirm before moving on; the unified balance is credited by Circle about
 * a second after the deposit confirms.
 */
export async function depositToGateway(
  provider: EthereumProvider,
  account: Address,
  amount: bigint
): Promise<DepositResult> {
  if (amount <= 0n) {
    throw new Error("Deposit amount must be greater than zero.");
  }
  const owner = getAddress(account);
  let approveHash: Hash | undefined;

  const allowance = await readGatewayAllowance(owner);
  if (allowance < amount) {
    approveHash = await requestWalletTransaction(
      provider,
      buildTransaction(
        owner,
        TOKENS.USDC.address,
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [GATEWAY_WALLET_ADDRESS, amount]
        }),
        await readPendingNonce(owner)
      )
    );
    await waitForTransactionConfirmation(approveHash);
  }

  const depositHash = await requestWalletTransaction(
    provider,
    buildTransaction(
      owner,
      GATEWAY_WALLET_ADDRESS,
      encodeFunctionData({
        abi: gatewayWalletAbi,
        functionName: "deposit",
        args: [TOKENS.USDC.address, amount]
      }),
      await readPendingNonce(owner)
    )
  );
  await waitForTransactionConfirmation(depositHash);

  return { approveHash, depositHash };
}

function buildTransaction(
  from: Address,
  to: Address,
  data: `0x${string}`,
  nonce: number
): WalletTransferTransaction {
  return { from, to, data, value: "0x0", nonce: numberToHex(nonce) };
}
