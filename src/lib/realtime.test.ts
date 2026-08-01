import { describe, expect, it } from "vitest";
import { ARC_DESTINATION_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID } from "./crosschain";
import type { PaymentRequest, Receipt } from "./payments";
import {
  applyQrRealtimeEvent,
  paymentRequestToRow,
  receiptToRow,
  rowToPaymentRequest,
  rowToReceipt,
  shouldHideQrForStatus
} from "./realtime";

const request: PaymentRequest = {
  id: "req_live_001",
  recipient: "0x1111111111111111111111111111111111111111",
  token: "USDC",
  amount: "12.34",
  label: "Invoice 7421",
  createdAt: "2026-04-30T00:00:00.000Z",
  expiresAt: "2026-04-30T00:15:00.000Z",
  startBlock: "800",
  status: "open"
};

const receipt: Receipt = {
  requestId: request.id,
  txHash: `0x${"a".repeat(64)}`,
  from: "0x2222222222222222222222222222222222222222",
  to: request.recipient,
  token: "USDC",
  amount: "12.34",
  blockNumber: "820",
  confirmedAt: "2026-04-30T00:02:00.000Z",
  explorerUrl: `https://testnet.arcscan.app/tx/0x${"a".repeat(64)}`
};

describe("QR realtime event reducer", () => {
  it("applies paid events with receipt details", () => {
    const applied = applyQrRealtimeEvent(request, {
      request_id: request.id,
      event_type: "paid",
      status: "paid",
      message: "Payment confirmed.",
      tx_hash: receipt.txHash,
      submitted_at: "2026-04-30T00:01:00.000Z",
      receipt
    });

    expect(applied.request).toMatchObject({
      id: request.id,
      status: "paid",
      txHash: receipt.txHash,
      submittedAt: "2026-04-30T00:01:00.000Z"
    });
    expect(applied.receipt?.txHash).toBe(receipt.txHash);
  });

  it("marks failed and expired statuses as QR-hiding final states", () => {
    expect(shouldHideQrForStatus("paid")).toBe(true);
    expect(shouldHideQrForStatus("failed")).toBe(true);
    expect(shouldHideQrForStatus("expired")).toBe(true);
    expect(shouldHideQrForStatus("open")).toBe(false);
  });

  it("clears a recoverable cross-chain wrong hash from realtime state", () => {
    const wrongHash = `0x${"d".repeat(64)}` as `0x${string}`;
    const applied = applyQrRealtimeEvent(
      {
        ...request,
        destinationChainId: ARC_DESTINATION_CHAIN_ID,
        allowedSourceChainIds: [ARC_DESTINATION_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
        txHash: wrongHash,
        settlement: {
          destinationChainId: ARC_DESTINATION_CHAIN_ID,
          sourceChainId: BASE_SEPOLIA_CHAIN_ID,
          sourceTxHash: wrongHash,
          stage: "proving"
        }
      },
      {
        request_id: request.id,
        event_type: "submitted",
        status: "open",
        message: "Submit the QR pay transaction hash.",
        tx_hash: null,
        settlement: {
          destinationChainId: ARC_DESTINATION_CHAIN_ID,
          sourceChainId: BASE_SEPOLIA_CHAIN_ID
        }
      }
    );

    expect(applied.request.txHash).toBeUndefined();
    expect(applied.request.settlement?.sourceTxHash).toBeUndefined();
    expect(applied.request.settlement?.stage).toBeUndefined();
  });

  it("round-trips request rows without losing final failed state", () => {
    const failed: PaymentRequest = { ...request, status: "failed", txHash: receipt.txHash };
    expect(rowToPaymentRequest(paymentRequestToRow(failed))).toMatchObject({
      status: "failed",
      txHash: receipt.txHash
    });
  });

  it("round-trips exact receipt block and log evidence", () => {
    const exactReceipt: Receipt = {
      ...receipt,
      blockHash: `0x${"b".repeat(64)}`,
      directSettlementLogIndex: 7
    };
    expect(rowToReceipt(receiptToRow(exactReceipt))).toMatchObject({
      blockHash: exactReceipt.blockHash,
      directSettlementLogIndex: 7
    });
  });
});
