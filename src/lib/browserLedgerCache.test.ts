import { afterEach, describe, expect, it, vi } from "vitest";
import { clearBrowserLedgerCache } from "./storage";

describe("retired browser payment storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("removes global ledgers and legacy persistent inbox credentials", () => {
    const keys = [
      "theme",
      "disburse.requests",
      "disburse.receipts",
      "arc-pay-desk.requests",
      "arc-pay-desk.receipts",
      "disburse.inboxAuth.0x1111111111111111111111111111111111111111"
    ];
    const removeItem = vi.fn();
    vi.stubGlobal("localStorage", {
      get length() {
        return keys.length;
      },
      key(index: number) {
        return keys[index] ?? null;
      },
      removeItem
    });

    clearBrowserLedgerCache();

    expect(removeItem).toHaveBeenCalledWith("disburse.requests");
    expect(removeItem).toHaveBeenCalledWith("disburse.receipts");
    expect(removeItem).toHaveBeenCalledWith("arc-pay-desk.requests");
    expect(removeItem).toHaveBeenCalledWith("arc-pay-desk.receipts");
    expect(removeItem).toHaveBeenCalledWith(
      "disburse.inboxAuth.0x1111111111111111111111111111111111111111"
    );
    expect(removeItem).not.toHaveBeenCalledWith("theme");
  });
});
