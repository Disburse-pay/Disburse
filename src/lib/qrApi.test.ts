import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmRemoteQrPayment, fetchRemoteQrStatus, recordRemoteQrSubmission } from "./qrApi";
import type { PaymentRequest } from "./payments";

const requestToken = "ab".repeat(32);
const txHash = `0x${"a".repeat(64)}` as `0x${string}`;
const authorization = `0x${"b".repeat(130)}` as `0x${string}`;
const request: PaymentRequest = {
  id: "request-1",
  recipient: "0x1111111111111111111111111111111111111111",
  token: "USDC",
  amount: "1",
  label: "Invoice",
  createdAt: "2026-07-29T00:00:00.000Z",
  startBlock: "700",
  status: "open"
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QR capability transport", () => {
  it("keeps the request capability out of the status URL", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ request }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRemoteQrStatus(request.id, requestToken)).resolves.toMatchObject({ request });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/qr-status?id=${request.id}`);
    expect(url).not.toContain(requestToken);
    expect((init as RequestInit).headers).toMatchObject({
      "X-Disburse-Request-Token": requestToken
    });
  });

  it("sends capability only in a header and payer authorization in the confirmation body", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ request: { ...request, status: "paid" }, status: "paid" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await confirmRemoteQrPayment(request.id, requestToken, txHash, authorization);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/qr-confirmations");
    expect((init as RequestInit).headers).toMatchObject({
      "X-Disburse-Request-Token": requestToken
    });
    expect((init as RequestInit).body).toBe(
      JSON.stringify({ id: request.id, txHash, authorization })
    );
    expect(String((init as RequestInit).body)).not.toContain(requestToken);
  });

  it("requires payer authorization when recording an advisory submission", async () => {
    const payer = "0x2222222222222222222222222222222222222222" as const;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ request }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await recordRemoteQrSubmission(request.id, requestToken, txHash, authorization, payer);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/qr-submissions");
    expect((init as RequestInit).body).toBe(
      JSON.stringify({
        id: request.id,
        txHash,
        authorization,
        payer
      })
    );
    expect(String((init as RequestInit).body)).not.toContain(requestToken);
  });
});
