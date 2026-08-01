import { describe, expect, it } from "vitest";
import type { PspV1 } from "../../lib/psp/types";
import { buildFetchCommand } from "./ReceiptProof";

describe("ReceiptProof verification command", () => {
  it("uses an independent issuer variable and never self-trusts the proof issuer", () => {
    const psp = {
      uid: "psp:0123456789abcdef",
      issuer: {
        publicKey: "0x1111111111111111111111111111111111111111"
      }
    } as unknown as PspV1;

    const command = buildFetchCommand(psp, "https://app.example");

    expect(command).toContain('--issuer "$DISBURSE_TRUSTED_PSP_ISSUER"');
    expect(command).toContain("uid=psp%3A0123456789abcdef");
    expect(command).not.toContain(psp.issuer.publicKey);
  });
});
