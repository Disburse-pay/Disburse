import { describe, expect, it } from "vitest";
import { parseGatewayDecimal } from "./balance";
import { signBurnIntent } from "./transfer";
import {
  ARC_GATEWAY_DOMAIN,
  BURN_INTENT_DOMAIN,
  addressToBytes32,
  stringifyWithBigints,
  type BurnIntent
} from "./types";
import type { EthereumProvider } from "../onchain";

describe("parseGatewayDecimal", () => {
  // /v1/balances returns decimal strings, not base units; BigInt("1.000000")
  // throws, which is exactly the trap this parser exists to avoid.
  it("parses Circle's decimal balance strings into USDC base units", () => {
    expect(parseGatewayDecimal("1.000000")).toBe(1_000000n);
    expect(parseGatewayDecimal("0.4965")).toBe(496500n);
    expect(parseGatewayDecimal("59.902871")).toBe(59_902871n);
    expect(parseGatewayDecimal("0")).toBe(0n);
  });

  it("returns zero for missing or malformed balances", () => {
    expect(parseGatewayDecimal(undefined)).toBe(0n);
    expect(parseGatewayDecimal("")).toBe(0n);
    expect(parseGatewayDecimal("not-a-number")).toBe(0n);
    expect(parseGatewayDecimal("-1.0")).toBe(0n);
  });
});

describe("addressToBytes32", () => {
  it("left-pads addresses to the bytes32 form TransferSpec uses", () => {
    expect(addressToBytes32("0x0077777d7eba4688bdef3e311b846f25870a19b9")).toBe(
      "0x0000000000000000000000000077777d7EBA4688BDeF3E311b846F25870A19B9"
    );
  });
});

describe("stringifyWithBigints", () => {
  it("renders bigints as decimal strings for Gateway's JSON body", () => {
    expect(stringifyWithBigints({ value: 500000n, nested: { maxFee: 1n } })).toBe(
      '{"value":"500000","nested":{"maxFee":"1"}}'
    );
  });
});

describe("signBurnIntent", () => {
  const burnIntent: BurnIntent = {
    maxBlockHeight: 123n,
    maxFee: 100000n,
    spec: {
      version: 1,
      sourceDomain: ARC_GATEWAY_DOMAIN,
      destinationDomain: ARC_GATEWAY_DOMAIN,
      sourceContract: addressToBytes32("0x0077777d7EBA4688BDeF3E311b846F25870A19B9"),
      destinationContract: addressToBytes32("0x0022222ABE238Cc2C7Bb1f21003F0a260052475B"),
      sourceToken: addressToBytes32("0x3600000000000000000000000000000000000000"),
      destinationToken: addressToBytes32("0x3600000000000000000000000000000000000000"),
      sourceDepositor: addressToBytes32("0x1111111111111111111111111111111111111111"),
      destinationRecipient: addressToBytes32("0x2222222222222222222222222222222222222222"),
      sourceSigner: addressToBytes32("0x1111111111111111111111111111111111111111"),
      destinationCaller: addressToBytes32("0x0000000000000000000000000000000000000000"),
      value: 500000n,
      salt: `0x${"ab".repeat(32)}`,
      hookData: "0x"
    }
  };

  it("signs with Circle's chainId-free domain and stringified uints", async () => {
    let captured: { method: string; params?: unknown } | undefined;
    const provider = {
      request: async (args: { method: string; params?: unknown }) => {
        captured = args;
        return `0x${"11".repeat(65)}`;
      }
    } as EthereumProvider;

    const signature = await signBurnIntent(
      provider,
      "0x1111111111111111111111111111111111111111",
      burnIntent
    );
    expect(signature).toBe(`0x${"11".repeat(65)}`);
    expect(captured?.method).toBe("eth_signTypedData_v4");

    const [signer, payload] = captured?.params as [string, string];
    expect(signer).toBe("0x1111111111111111111111111111111111111111");
    const typedData = JSON.parse(payload);
    // Chain binding lives in spec.sourceDomain, not the EIP-712 domain.
    expect(typedData.domain).toEqual(BURN_INTENT_DOMAIN);
    expect(typedData.domain.chainId).toBeUndefined();
    expect(typedData.primaryType).toBe("BurnIntent");
    expect(typedData.message.maxBlockHeight).toBe("123");
    expect(typedData.message.spec.value).toBe("500000");
  });

  it("rejects a malformed wallet signature", async () => {
    const provider = {
      request: async () => "0xnope"
    } as unknown as EthereumProvider;

    await expect(
      signBurnIntent(provider, "0x1111111111111111111111111111111111111111", burnIntent)
    ).rejects.toThrow("valid burn intent signature");
  });
});
