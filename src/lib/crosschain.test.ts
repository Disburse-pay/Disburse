import { describe, expect, it } from "vitest";
import {
  ARC_DESTINATION_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  MONAD_TESTNET_CHAIN_ID,
  buildCrossChainNonce,
  getAllowedSourceChainIds,
  getCrossChain,
  requestIdToBytes32
} from "./crosschain";
import {
  decodeRequestPayload,
  encodeRequestPayload,
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

describe("cross-chain QR payloads", () => {
  it("round-trips v2 QR requests without legacy Arc start block requirements", () => {
    const decoded = decodeRequestPayload(encodeRequestPayload(crossChainRequest));

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

  it("exposes Monad as a remote payment source with MON gas", () => {
    expect(getCrossChain(MONAD_TESTNET_CHAIN_ID)).toMatchObject({
      label: "Monad Testnet",
      rpcUrl: "https://testnet-rpc.monad.xyz",
      explorerUrl: "https://testnet.monadscan.com",
      nativeSymbol: "MON"
    });
  });

  it("does not advertise Monad while Polymer leaves Monad proof jobs pending", () => {
    expect(getAllowedSourceChainIds()).toEqual([ARC_DESTINATION_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID]);
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

  it("uses deterministic bytes32 ids and nonces for contract calls", () => {
    expect(requestIdToBytes32(crossChainRequest.id)).toMatch(/^0x[a-f0-9]{64}$/);
    expect(buildCrossChainNonce(crossChainRequest.id, BASE_SEPOLIA_CHAIN_ID, ARC_DESTINATION_CHAIN_ID)).toBe(
      buildCrossChainNonce(crossChainRequest.id, BASE_SEPOLIA_CHAIN_ID, ARC_DESTINATION_CHAIN_ID)
    );
  });
});
