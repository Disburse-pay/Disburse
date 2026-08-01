import { describe, expect, it } from "vitest";
import {
  ARC_DESTINATION_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  MONAD_TESTNET_CHAIN_ID,
  getCrossChainLabel,
  requestIdToBytes32
} from "./crosschain";
import {
  decodeRequestPayload,
  isCrossChainPaymentRequest,
  type PaymentRequest
} from "./payments";

const crossChainRequest: PaymentRequest = {
  id: "7e7b5b2f-9df1-4ea1-a0da-0889fb6bd4fd",
  recipient: "0x1111111111111111111111111111111111111111",
  token: "USDC",
  amount: "12.34",
  label: "Cross-chain invoice",
  createdAt: "2026-04-30T00:00:00.000Z",
  expiresAt: "2026-04-30T00:15:00.000Z",
  startBlock: "0",
  status: "open",
  destinationChainId: ARC_DESTINATION_CHAIN_ID,
  allowedSourceChainIds: [ARC_DESTINATION_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, MONAD_TESTNET_CHAIN_ID],
  settlement: {
    destinationChainId: ARC_DESTINATION_CHAIN_ID
  }
};

function encodeRawPayload(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

// The Polymer settlement stack is retired, but v2 pay links and stored
// cross-chain records must keep decoding and rendering.
describe("legacy cross-chain QR payloads", () => {
  it("round-trips v2 QR requests without legacy Arc start block requirements", () => {
    const decoded = decodeRequestPayload(
      encodeRawPayload({
        version: 2,
        id: crossChainRequest.id,
        recipient: crossChainRequest.recipient,
        token: crossChainRequest.token,
        amount: crossChainRequest.amount,
        label: crossChainRequest.label,
        createdAt: crossChainRequest.createdAt,
        expiresAt: crossChainRequest.expiresAt,
        destinationChainId: crossChainRequest.destinationChainId,
        allowedSourceChainIds: crossChainRequest.allowedSourceChainIds
      })
    );

    expect(isCrossChainPaymentRequest(decoded)).toBe(true);
    expect(decoded).toMatchObject({
      id: crossChainRequest.id,
      recipient: crossChainRequest.recipient,
      token: "USDC",
      amount: "12.34",
      destinationChainId: ARC_DESTINATION_CHAIN_ID,
      allowedSourceChainIds: [ARC_DESTINATION_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, MONAD_TESTNET_CHAIN_ID],
      startBlock: "0",
      status: "open"
    });
  });

  it("filters old MegaETH source ids from scanned v2 payloads", () => {
    const decoded = decodeRequestPayload(
      encodeRawPayload({
        version: 2,
        id: crossChainRequest.id,
        recipient: crossChainRequest.recipient,
        token: "USDC",
        amount: "12.34",
        label: "Old route",
        createdAt: crossChainRequest.createdAt,
        destinationChainId: ARC_DESTINATION_CHAIN_ID,
        allowedSourceChainIds: [BASE_SEPOLIA_CHAIN_ID, 6_343]
      })
    );

    expect(decoded.allowedSourceChainIds).toEqual([BASE_SEPOLIA_CHAIN_ID]);
  });

  it("rejects cross-chain routes without supported source chains", () => {
    expect(() =>
      decodeRequestPayload(
        encodeRawPayload({
          version: 2,
          id: crossChainRequest.id,
          recipient: crossChainRequest.recipient,
          token: "USDC",
          amount: "12.34",
          label: "Bad route",
          createdAt: crossChainRequest.createdAt,
          destinationChainId: ARC_DESTINATION_CHAIN_ID,
          allowedSourceChainIds: []
        })
      )
    ).toThrow("source chains");
  });

  it("keeps labels and deterministic bytes32 ids for stored records", () => {
    expect(getCrossChainLabel(BASE_SEPOLIA_CHAIN_ID)).toBe("Base Sepolia");
    expect(getCrossChainLabel(MONAD_TESTNET_CHAIN_ID)).toBe("Monad Testnet");
    expect(requestIdToBytes32(crossChainRequest.id)).toMatch(/^0x[a-f0-9]{64}$/);
  });
});
