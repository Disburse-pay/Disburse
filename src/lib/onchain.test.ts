import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  formatUnits,
  parseGwei,
  parseUnits,
  type Address,
  type Hash,
  type TransactionReceipt
} from "viem";
import { ARC_MIN_GAS_PRICE, TOKENS, erc20Abi } from "./arc";
import {
  applyArcGasFloor,
  assertSuccessfulTransactionReceipt,
  buildErc20TransferTransaction,
  getConfirmedTokenTransfer,
  getSpendabilityCheck,
  hasInsufficientNativeSpendBalance,
  selectActiveRpcEndpoint,
  type Balances,
  type RpcEndpointStatus
} from "./onchain";
import type { PaymentRequest } from "./payments";

const recipient = "0x1111111111111111111111111111111111111111" as Address;
const sender = "0x2222222222222222222222222222222222222222" as Address;

const baseRequest: PaymentRequest = {
  id: "req_reliability_001",
  recipient,
  token: "USDC",
  amount: "12.34",
  label: "Invoice 7421",
  createdAt: "2026-04-28T00:00:00.000Z",
  startBlock: "700",
  status: "open"
};

describe("Arc gas policy", () => {
  it("enforces the documented 20 gwei minimum gas price", () => {
    expect(applyArcGasFloor(parseGwei("1"))).toBe(ARC_MIN_GAS_PRICE);
    expect(applyArcGasFloor(parseGwei("20"))).toBe(ARC_MIN_GAS_PRICE);
    expect(applyArcGasFloor(parseGwei("25"))).toBe(parseGwei("25"));
  });
});

describe("wallet transfer transaction", () => {
  it("builds minimal ERC-20 calldata and lets the wallet finalize gas", () => {
    const transaction = buildErc20TransferTransaction(sender, baseRequest);

    expect(transaction).toMatchObject({
      from: sender,
      to: TOKENS.USDC.address,
      value: "0x0"
    });
    expect(transaction).not.toHaveProperty("gas");
    expect(transaction).not.toHaveProperty("gasPrice");
    expect(transaction.data).toMatch(/^0xa9059cbb/);
    expect(transaction.data).toContain(recipient.slice(2).toLowerCase());
  });

  it("pins the pending account nonce without app-owned gas overrides", () => {
    const transaction = buildErc20TransferTransaction(sender, baseRequest, 0);

    expect(transaction.nonce).toBe("0x0");
    expect(transaction).not.toHaveProperty("gas");
    expect(transaction).not.toHaveProperty("gasPrice");
  });
});

describe("transaction receipt confirmation", () => {
  const hash = `0x${"d".repeat(64)}` as Hash;
  const amount = 12_340_000n;
  const transferLog = {
    address: TOKENS.USDC.address,
    blockNumber: 701n,
    transactionHash: hash,
    logIndex: 4,
    topics: encodeEventTopics({
      abi: erc20Abi,
      eventName: "Transfer",
      args: { from: sender, to: recipient }
    }),
    data: encodeAbiParameters([{ type: "uint256" }], [amount])
  };

  it("rejects reverted and replacement receipts", () => {
    expect(() =>
      assertSuccessfulTransactionReceipt(
        { status: "reverted", transactionHash: hash } as unknown as TransactionReceipt,
        hash
      )
    ).toThrow("reverted");
    expect(() =>
      assertSuccessfulTransactionReceipt(
        {
          status: "success",
          transactionHash: `0x${"e".repeat(64)}`
        } as unknown as TransactionReceipt,
        hash
      )
    ).toThrow("replaced");
  });

  it("accepts only the exact token, sender, recipient, and amount log", () => {
    const receipt = {
      status: "success",
      transactionHash: hash,
      blockNumber: 701n,
      logs: [transferLog]
    } as unknown as TransactionReceipt;

    expect(getConfirmedTokenTransfer(receipt, hash, baseRequest, sender)).toMatchObject({
      txHash: hash,
      from: sender,
      to: recipient,
      value: amount,
      logIndex: 4
    });
    expect(() =>
      getConfirmedTokenTransfer(receipt, hash, { ...baseRequest, amount: "12.35" }, sender)
    ).toThrow("did not emit");
    expect(() =>
      getConfirmedTokenTransfer(
        receipt,
        hash,
        baseRequest,
        "0x3333333333333333333333333333333333333333"
      )
    ).toThrow("did not emit");
  });
});

describe("payer spendability checks", () => {
  const estimate = {
    gas: 55_349n,
    gasPrice: parseGwei("20"),
    fee: "0.00110698"
  };

  it("blocks USDC when balance covers amount and gas separately but not amount plus gas", () => {
    const balances: Balances = {
      nativeGas: "10.0005",
      tokenBalance: "10.0005",
      gasPrice: formatUnits(parseGwei("20"), 18)
    };
    const transfer = { recipient, token: "USDC", amount: "10" } as const;
    const spendability = getSpendabilityCheck(balances, transfer, estimate);

    expect(spendability.hasEnoughToken).toBe(true);
    expect(spendability.gasFee).toBe(estimate.gas * estimate.gasPrice);
    expect(spendability.requiredNative).toBe(parseUnits("10", 18) + estimate.gas * estimate.gasPrice);
    expect(hasInsufficientNativeSpendBalance(balances, transfer, estimate)).toBe(true);
  });

  it("keeps EURC token amount and native USDC gas checks separate", () => {
    const transfer = { recipient, token: "EURC", amount: "10" } as const;
    const fundedBalances: Balances = {
      nativeGas: "0.002",
      tokenBalance: "10",
      gasPrice: formatUnits(parseGwei("20"), 18)
    };
    const lowTokenBalances: Balances = {
      ...fundedBalances,
      tokenBalance: "9.99"
    };
    const lowGasBalances: Balances = {
      ...fundedBalances,
      nativeGas: "0.0005"
    };

    const spendability = getSpendabilityCheck(fundedBalances, transfer, estimate);
    expect(spendability.requiredNative).toBe(estimate.gas * estimate.gasPrice);
    expect(spendability.hasEnoughToken).toBe(true);
    expect(spendability.hasEnoughNative).toBe(true);
    expect(getSpendabilityCheck(lowTokenBalances, transfer, estimate).hasEnoughToken).toBe(false);
    expect(hasInsufficientNativeSpendBalance(fundedBalances, transfer, estimate)).toBe(false);
    expect(hasInsufficientNativeSpendBalance(lowGasBalances, transfer, estimate)).toBe(true);
  });
});

describe("RPC endpoint selection", () => {
  it("selects the healthiest endpoint by freshest block, then latency", () => {
    const statuses: RpcEndpointStatus[] = [
      {
        id: "public",
        label: "Arc public",
        url: "https://rpc.testnet.arc.network",
        host: "rpc.testnet.arc.network",
        healthy: true,
        blockNumber: "100",
        latencyMs: 30
      },
      {
        id: "drpc",
        label: "dRPC",
        url: "https://rpc.drpc.testnet.arc.network",
        host: "rpc.drpc.testnet.arc.network",
        healthy: true,
        blockNumber: "101",
        latencyMs: 90
      },
      {
        id: "quicknode",
        label: "QuickNode",
        url: "https://rpc.quicknode.testnet.arc.network",
        host: "rpc.quicknode.testnet.arc.network",
        healthy: false
      }
    ];

    expect(selectActiveRpcEndpoint(statuses)?.id).toBe("drpc");

    statuses[0].blockNumber = "101";
    expect(selectActiveRpcEndpoint(statuses)?.id).toBe("public");
  });
});
