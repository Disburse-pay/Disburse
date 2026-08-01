import { describe, expect, it, vi } from "vitest";
import {
  HttpError,
  readHeaderString,
  readJsonBody,
  readQueryString,
  sendError,
  type ApiResponse
} from "./http";

describe("HTTP helpers", () => {
  it("rejects repeated query parameters instead of silently trusting the first", () => {
    expect(() =>
      readQueryString(
        { query: { uid: ["psp:one", "psp:two"] } },
        "uid"
      )
    ).toThrow('Query parameter "uid" must be provided exactly once.');
  });

  it("maps malformed JSON request bodies to a 400 error", () => {
    expect(() => readJsonBody({ body: "{bad json" })).toThrow(HttpError);

    try {
      readJsonBody({ body: "{bad json" });
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).statusCode).toBe(400);
      expect((error as HttpError).message).toBe("Request body must be valid JSON.");
    }
  });

  it("reads headers case-insensitively and rejects repeated values", () => {
    expect(readHeaderString({ headers: { "X-Disburse-Wallet": "0xabc" } }, "x-disburse-wallet")).toBe(
      "0xabc"
    );
    expect(() =>
      readHeaderString(
        { headers: { "x-disburse-signature": ["0xfirst", "0xsecond"] } },
        "x-disburse-signature"
      )
    ).toThrow('Header "x-disburse-signature" must be provided exactly once.');
    expect(() =>
      readHeaderString(
        {
          headers: {
            "X-Disburse-Wallet": "0xfirst",
            "x-disburse-wallet": "0xsecond"
          }
        },
        "x-disburse-wallet"
      )
    ).toThrow('Header "x-disburse-wallet" must be provided exactly once.');
  });

  it("does not expose unexpected internal error messages", () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
    const state: { status?: number; body?: unknown } = {};
    const response: ApiResponse = {
      status: (status: number) => {
        state.status = status;
        return response;
      },
      json: (body: unknown) => {
        state.body = body;
      }
    };

    sendError(response, new Error("password authentication failed for db.internal"));

    expect(state).toEqual({
      status: 500,
      body: { error: "Unexpected server error." }
    });
  });
});
