import { encodeAbiParameters, encodeEventTopics, type Log } from "viem";
import { describe, expect, it } from "vitest";
import { erc20Abi, TOKENS } from "../src/lib/arc.js";
import { parseTokenAmount, type PaymentRequest } from "../src/lib/payments.js";
import { readCreateQrRequestInput, resolveSubmittedReceiptConfirmation } from "./qr.js";

const recipient = "0x1111111111111111111111111111111111111111";
const sender = "0x2222222222222222222222222222222222222222";

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
      logs: [transferLog(parseTokenAmount("12.34", "USDC"))]
    });

    expect(result.status).toBe("paid");
    expect(result.status === "paid" ? result.receipt.txHash : undefined).toBe(`0x${"c".repeat(64)}`);
  });

  it("maps a mismatched amount to failed", () => {
    const result = resolveSubmittedReceiptConfirmation(request, {
      status: "success",
      logs: [transferLog(parseTokenAmount("12.33", "USDC"))]
    });

    expect(result).toMatchObject({
      status: "failed",
      message: "A transfer reached the requester, but the amount does not match this QR request."
    });
  });

  it("maps a reverted transaction to failed", () => {
    const result = resolveSubmittedReceiptConfirmation(request, {
      status: "reverted",
      logs: []
    });

    expect(result).toMatchObject({
      status: "failed",
      message: "The submitted transaction reverted on Arc Testnet."
    });
  });

});

function transferLog(value: bigint): Log {
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
    blockNumber: 820n,
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    topics,
    transactionHash: request.txHash
  } as unknown as Log;
}
