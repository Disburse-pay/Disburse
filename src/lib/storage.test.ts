import { describe, expect, it } from "vitest";
import { buildExportBundle, upsertReceipt, upsertRequest } from "./storage";
import type { PaymentRequest, Receipt } from "./payments";

const recipient = "0x1111111111111111111111111111111111111111" as const;
const sender = "0x2222222222222222222222222222222222222222" as const;
const txHash = `0x${"a".repeat(64)}` as `0x${string}`;

const request: PaymentRequest = {
  id: "request-1",
  requestToken: "a".repeat(43),
  paymentAuthorization: `0x${"b".repeat(128)}`,
  recipient,
  token: "USDC",
  amount: "1",
  label: "Invoice",
  createdAt: "2026-04-28T00:00:00.000Z",
  startBlock: "700",
  status: "open"
};

const receipt: Receipt = {
  requestId: request.id,
  txHash,
  from: sender,
  to: recipient,
  token: "USDC",
  amount: "1",
  blockNumber: "701",
  confirmedAt: "2026-04-28T00:01:00.000Z",
  explorerUrl: `https://testnet.arcscan.app/tx/${txHash}`
};

describe("memory-only ledger helpers", () => {
  it("excludes bearer capabilities and payer signatures from exports", () => {
    const exported = buildExportBundle([request], [receipt]);
    expect(exported.requests[0]).not.toHaveProperty("requestToken");
    expect(exported.requests[0]).not.toHaveProperty("paymentAuthorization");
    expect(exported.receipts).toEqual([receipt]);
  });

  it("upserts requests and receipts without duplicating canonical identifiers", () => {
    const paid = { ...request, status: "paid" as const, txHash };
    expect(upsertRequest([request], paid)).toEqual([paid]);
    expect(upsertRequest([], request)).toEqual([request]);

    const updatedReceipt = { ...receipt, confirmedAt: "2026-04-28T00:02:00.000Z" };
    expect(upsertReceipt([receipt], updatedReceipt)).toEqual([updatedReceipt]);
    expect(upsertReceipt([], receipt)).toEqual([receipt]);
  });
});
