import { describe, expect, it } from "vitest";
import { toBigIntBE, toBigIntLE, toBufferBE, toBufferLE } from "bigint-buffer";

describe("pure JavaScript bigint-buffer override", () => {
  it("converts both byte orders without native code", () => {
    expect(toBigIntBE(Buffer.from([0x01, 0x02, 0x03]))).toBe(0x010203n);
    expect(toBigIntLE(Buffer.from([0x03, 0x02, 0x01]))).toBe(0x010203n);
    expect(toBufferBE(0x010203n, 4)).toEqual(Buffer.from([0x00, 0x01, 0x02, 0x03]));
    expect(toBufferLE(0x010203n, 4)).toEqual(Buffer.from([0x03, 0x02, 0x01, 0x00]));
  });

  it("handles empty values and rejects truncating output", () => {
    expect(toBigIntBE(Buffer.alloc(0))).toBe(0n);
    expect(toBigIntLE(Buffer.alloc(0))).toBe(0n);
    expect(toBufferBE(0n, 0)).toEqual(Buffer.alloc(0));
    expect(() => toBufferBE(256n, 1)).toThrow(/does not fit/i);
    expect(() => toBufferLE(-1n, 1)).toThrow(/non-negative/i);
  });
});
