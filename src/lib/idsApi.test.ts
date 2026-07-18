import { describe, expect, it } from "vitest";
import { handleFromInput, looksLikeHandleInput } from "./idsApi";

describe("Disburse ID recipient input", () => {
  it("recognizes handles with or without an @ prefix", () => {
    expect(looksLikeHandleInput("undunable")).toBe(true);
    expect(looksLikeHandleInput("@undunable")).toBe(true);
    expect(handleFromInput(" @Undunable ")).toBe("undunable");
  });

  it("keeps wallet addresses on the direct-wallet rail", () => {
    expect(looksLikeHandleInput("0x1111111111111111111111111111111111111111")).toBe(false);
    expect(looksLikeHandleInput("not a valid recipient")).toBe(false);
  });
});
