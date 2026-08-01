import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bridge storage isolation", () => {
  it("keeps transfer and recovery state out of browser persistence", () => {
    const source = readFileSync(new URL("./BridgeApp.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\s*\./);
  });
});
