import { describe, expect, it, vi } from "vitest";

// Isolate Polymer so we can drive the proof status without touching the network.
vi.mock("./polymer.js", () => ({
  queryPolymerProof: vi.fn(),
  requestPolymerProof: vi.fn(),
  pollPolymerProof: vi.fn(),
  decodePolymerProofToHex: vi.fn()
}));

import { ARC_DESTINATION_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID } from "../src/lib/crosschain.js";
import type { PaymentRequest } from "../src/lib/payments.js";
import { tryCompleteCrossChainSettlement, type CrossChainSourcePayment } from "./crosschain.js";
import { queryPolymerProof } from "./polymer.js";

const request = {
  id: "11111111-1111-1111-1111-111111111111",
  recipient: "0x1111111111111111111111111111111111111111",
  token: "USDC",
  amount: "5",
  createdAt: "2026-06-05T00:00:00.000Z",
  status: "open",
  destinationChainId: ARC_DESTINATION_CHAIN_ID,
  allowedSourceChainIds: [ARC_DESTINATION_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
  settlement: {
    destinationChainId: ARC_DESTINATION_CHAIN_ID,
    sourceChainId: BASE_SEPOLIA_CHAIN_ID,
    sourceTxHash: `0x${"a".repeat(64)}`,
    sourceBlockNumber: "100",
    sourceLogIndex: 0,
    proofJobId: "123",
    stage: "settling"
  }
} as unknown as PaymentRequest;

const sourcePayment: CrossChainSourcePayment = {
  sourceChainId: BASE_SEPOLIA_CHAIN_ID,
  sourceTxHash: `0x${"a".repeat(64)}`,
  sourceBlockNumber: "100",
  sourceLogIndex: 0,
  payer: "0x2222222222222222222222222222222222222222",
  recipient: "0x1111111111111111111111111111111111111111",
  token: "0x3600000000000000000000000000000000000000",
  amount: 5_000_000n,
  destinationChainId: ARC_DESTINATION_CHAIN_ID,
  nonce: 1n
};

describe("tryCompleteCrossChainSettlement", () => {
  it("returns null (stays settling) while the proof is pending — no settle attempted", async () => {
    vi.mocked(queryPolymerProof).mockResolvedValue({ status: "pending" });
    await expect(tryCompleteCrossChainSettlement(request, sourcePayment, 123)).resolves.toBeNull();
  });

  it("throws a clear error when proof generation failed", async () => {
    vi.mocked(queryPolymerProof).mockResolvedValue({
      status: "error",
      failureReason: "proof job failed"
    });
    await expect(tryCompleteCrossChainSettlement(request, sourcePayment, 123)).rejects.toThrow(
      "proof job failed"
    );
  });
});
