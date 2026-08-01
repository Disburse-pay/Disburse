import { encodeAbiParameters, encodeEventTopics, type Log } from "viem";
import { describe, expect, it } from "vitest";
import { erc20Abi, TOKENS } from "../src/lib/arc.js";
import { parseTokenAmount, type PaymentRequest } from "../src/lib/payments.js";
import { readCreateQrRequestInput, resolveSubmittedReceiptConfirmation } from "./qr.js";

const recipient = "0x1111111111111111111111111111111111111111";
const sender = "0x2222222222222222222222222222222222222222";
const blockHash = `0x${"b".repeat(64)}` as const;

const request: PaymentRequest = {
  id: "7e7b5b2f-9df1-4ea1-a0da-0889fb6bd4fd",
  recipient,
  token: "USDC",
  amount: "12.34",
  label: "Invoice 7421",
  createdAt: "2026-04-30T00:00:00.000Z",
  expiresAt: "2026-04-30T00:15:00.000Z",
  startBlock: "800",
  status: "open",
  txHash: `0x${"c".repeat(64)}`
};

describe("server QR confirmation mapping", () => {
  it("rejects non-USDC QR creation inputs", () => {
    expect(() =>
      readCreateQrRequestInput({
        recipient,
        token: "EURC",
        amount: "12.34",
        label: "Invoice 7421",
        invoiceDate: "2026-04-30"
      })
    ).toThrow("USDC only");
  });

  it("maps an exact ERC-20 transfer receipt to paid", () => {
    const result = resolveSubmittedReceiptConfirmation(request, {
      status: "success",
      logs: [transferLog(parseTokenAmount("12.34", "USDC"))],
      blockNumber: 820n,
      blockHash,
      blockTimestamp: unixSeconds("2026-04-30T00:05:00.000Z"),
      transactionHash: request.txHash!
    });

    expect(result.status).toBe("paid");
    expect(result.status === "paid" ? result.receipt.txHash : undefined).toBe(`0x${"c".repeat(64)}`);
    expect(result.status === "paid" ? result.receipt.blockHash : undefined).toBe(blockHash);
    expect(result.status === "paid" ? result.receipt.directSettlementLogIndex : undefined).toBe(3);
  });

  it("rejects ambiguous duplicate matching transfers", () => {
    const first = transferLog(parseTokenAmount("12.34", "USDC"));
    const second = { ...first, logIndex: 4 } as Log;
    const result = resolveSubmittedReceiptConfirmation(request, {
      status: "success",
      logs: [first, second],
      blockNumber: 820n,
      blockHash,
      blockTimestamp: unixSeconds("2026-04-30T00:05:00.000Z"),
      transactionHash: request.txHash!
    });

    expect(result).toMatchObject({
      status: "rejected",
      message: "The transaction contains multiple indistinguishable payment transfers."
    });
  });

  it("rejects a mismatched amount without closing the request", () => {
    const result = resolveSubmittedReceiptConfirmation(request, {
      status: "success",
      logs: [transferLog(parseTokenAmount("12.33", "USDC"))],
      blockNumber: 820n,
      blockHash,
      blockTimestamp: unixSeconds("2026-04-30T00:05:00.000Z"),
      transactionHash: request.txHash!
    });

    expect(result).toMatchObject({
      status: "rejected",
      message: "A transfer reached the requester, but the amount does not match this QR request."
    });
  });

  it("rejects a reverted transaction without closing the request", () => {
    const result = resolveSubmittedReceiptConfirmation(request, {
      status: "reverted",
      logs: [],
      blockNumber: 820n,
      blockHash,
      blockTimestamp: unixSeconds("2026-04-30T00:05:00.000Z"),
      transactionHash: request.txHash!
    });

    expect(result).toMatchObject({
      status: "rejected",
      message: "The submitted transaction reverted on Arc Testnet."
    });
  });

  it("rejects a matching transfer from before the request start block", () => {
    const result = resolveSubmittedReceiptConfirmation(request, {
      status: "success",
      logs: [transferLog(parseTokenAmount("12.34", "USDC"), 799n)],
      blockNumber: 799n,
      blockHash,
      blockTimestamp: unixSeconds("2026-04-30T00:05:00.000Z"),
      transactionHash: request.txHash!
    });

    expect(result).toMatchObject({
      status: "rejected",
      message: "The transaction predates this QR request."
    });
  });

  it("rejects a matching transfer mined after expiry", () => {
    const result = resolveSubmittedReceiptConfirmation(request, {
      status: "success",
      logs: [transferLog(parseTokenAmount("12.34", "USDC"))],
      blockNumber: 820n,
      blockHash,
      blockTimestamp: unixSeconds("2026-04-30T00:15:01.000Z"),
      transactionHash: request.txHash!
    });

    expect(result).toMatchObject({
      status: "rejected",
      message: "The transaction falls outside this QR request's payment window."
    });
  });

  it("rejects a matching log from a different transaction", () => {
    const result = resolveSubmittedReceiptConfirmation(request, {
      status: "success",
      logs: [transferLog(parseTokenAmount("12.34", "USDC"), 820n, `0x${"d".repeat(64)}`)],
      blockNumber: 820n,
      blockHash,
      blockTimestamp: unixSeconds("2026-04-30T00:05:00.000Z"),
      transactionHash: request.txHash!
    });

    expect(result).toMatchObject({
      status: "rejected",
      message: "The submitted transaction does not pay this QR request."
    });
  });

});

function transferLog(value: bigint, blockNumber = 820n, transactionHash = request.txHash!): Log {
  const topics = encodeEventTopics({
    abi: erc20Abi,
    eventName: "Transfer",
    args: {
      from: sender,
      to: recipient
    }
  });

  return {
    address: TOKENS.USDC.address,
    blockNumber,
    blockHash,
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    topics,
    transactionHash,
    logIndex: 3
  } as unknown as Log;
}

function unixSeconds(value: string): bigint {
  return BigInt(Math.floor(new Date(value).getTime() / 1_000));
}
