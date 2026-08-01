import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import {
  clearInboxAuth,
  readCachedInboxAuth,
  requestInboxAuth
} from "./notificationsApi";
import type { EthereumProvider } from "./onchain";

const WALLET_A = "0x1111111111111111111111111111111111111111" as Address;
const WALLET_B = "0x2222222222222222222222222222222222222222" as Address;
const SIGNATURE = `0x${"ab".repeat(65)}`;

describe("inbox authorization cache", () => {
  afterEach(() => {
    clearInboxAuth(WALLET_A);
    clearInboxAuth(WALLET_B);
    vi.unstubAllGlobals();
  });

  it("keeps credentials memory-only and wallet-scoped", async () => {
    const localStorage = {
      removeItem: vi.fn(),
      setItem: vi.fn()
    };
    vi.stubGlobal("window", { localStorage });
    const provider = {
      request: vi.fn().mockResolvedValue(SIGNATURE)
    } as unknown as EthereumProvider;

    await requestInboxAuth(provider, WALLET_A);

    expect(readCachedInboxAuth(WALLET_A)).toMatchObject({ wallet: WALLET_A });
    expect(readCachedInboxAuth(WALLET_B)).toBeUndefined();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(localStorage.removeItem).toHaveBeenCalledWith(
      `disburse.inboxAuth.${WALLET_A.toLowerCase()}`
    );
  });
});
