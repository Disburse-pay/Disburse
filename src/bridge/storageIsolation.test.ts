import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bridge storage isolation", () => {
  it("keeps transfer and recovery state out of browser persistence", () => {
    for (const file of ["BridgeApp.tsx", "config.ts", "recovery.ts"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\s*\./);
    }
  });
});
