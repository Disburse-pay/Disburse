import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Address } from "viem";
import type { PaymentRequest, Receipt } from "../src/lib/payments";
import { paymentRequestToRow, receiptToRow } from "../src/lib/realtime";
import { normalizeWalletHistory } from "./history";
import {
  paymentRequestCapabilityAssociatedData,
  sealNotificationRequestToken
} from "./notifications";

const owner = "0x1111111111111111111111111111111111111111" as Address;
const counterparty = "0x2222222222222222222222222222222222222222" as Address;
const foreign = "0x3333333333333333333333333333333333333333" as Address;
const previousKey = process.env.DISBURSE_NOTIFICATION_ENCRYPTION_KEY;

function request(id: string, recipient: Address): PaymentRequest {
  return {
    id,
    recipient,
    token: "USDC",
    amount: "10",
    label: "Invoice",
    createdAt: "2026-07-31T00:00:00.000Z",
    startBlock: "100",
    status: "paid",
    txHash: `0x${id.slice(-1).repeat(64)}` as `0x${string}`
  };
}

function receipt(value: PaymentRequest, payer: Address): Receipt {
  return {
    requestId: value.id,
    txHash: value.txHash as `0x${string}`,
    from: payer,
    to: value.recipient,
    token: value.token,
    amount: value.amount,
    blockNumber: "101",
    blockHash: `0x${"a".repeat(64)}`,
    directSettlementLogIndex: 1,
    confirmedAt: "2026-07-31T00:01:00.000Z",
    explorerUrl: `https://testnet.arcscan.app/tx/${value.txHash}`
  };
}

describe("wallet-scoped history normalization", () => {
  beforeEach(() => {
    process.env.DISBURSE_NOTIFICATION_ENCRYPTION_KEY = "ab".repeat(32);
  });

  afterEach(() => {
    if (previousKey === undefined) {
      delete process.env.DISBURSE_NOTIFICATION_ENCRYPTION_KEY;
    } else {
      process.env.DISBURSE_NOTIFICATION_ENCRYPTION_KEY = previousKey;
    }
  });

  it("keeps only incoming/outgoing records for the signed wallet and unwraps only its QR capability", () => {
    const incoming = request("11111111-1111-4111-8111-111111111111", owner);
    const outgoing = request("22222222-2222-4222-8222-222222222222", counterparty);
    const unrelated = request("33333333-3333-4333-8333-333333333333", foreign);
    const token = "cd".repeat(32);

    const history = normalizeWalletHistory({
      requests: [incoming, outgoing, unrelated].map((item) => paymentRequestToRow(item)),
      receipts: [
        receipt(incoming, counterparty),
        receipt(outgoing, owner),
        receipt(unrelated, counterparty)
      ].map(receiptToRow),
      capabilities: [{
        request_id: incoming.id,
        capability_envelope: sealNotificationRequestToken(
          token,
          paymentRequestCapabilityAssociatedData(owner, incoming.id)
        )
      }],
      has_more: false
    }, owner);

    expect(history.requests.map((item) => item.id)).toEqual([incoming.id, outgoing.id]);
    expect(history.receipts.map((item) => item.requestId)).toEqual([incoming.id, outgoing.id]);
    expect(history.requests.find((item) => item.id === incoming.id)?.requestToken).toBe(token);
    expect(history.requests.find((item) => item.id === outgoing.id)?.requestToken).toBeUndefined();
  });

  it("keeps the ledger available but omits a damaged capability", () => {
    const incoming = request("11111111-1111-4111-8111-111111111111", owner);
    const history = normalizeWalletHistory({
      requests: [paymentRequestToRow(incoming)],
      receipts: [receiptToRow(receipt(incoming, counterparty))],
      capabilities: [{ request_id: incoming.id, capability_envelope: { version: 1 } }],
      has_more: true
    }, owner);

    expect(history.requests).toHaveLength(1);
    expect(history.requests[0].requestToken).toBeUndefined();
    expect(history.hasMore).toBe(true);
  });
});
