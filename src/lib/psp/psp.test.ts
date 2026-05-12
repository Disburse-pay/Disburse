import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  buildDomainSeparator,
  canonicalBytes,
  computeDigest,
  deterministicStringify,
  extractCore,
} from "./canonical";
import { buildSignedPsp, signPsp, verifyPspSignature } from "./sign";
import { verify, verifyJson } from "./verify";
import type { PspCore, PspV1 } from "./types";

// ---------- Fixtures ----------

function createTestKey(): { privateKey: Hex; address: Address } {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}

function createTestCore(issuerAddress: Address): PspCore {
  return {
    version: 1,
    networkMode: "testnet",
    issuer: {
      name: "Disburse",
      url: "https://disburse.app",
      publicKey: issuerAddress,
    },
    invoice: {
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      label: "Test Invoice",
      invoiceDate: "2025-06-01",
      note: "Payment for services",
      payer: "0x1234567890123456789012345678901234567890" as Address,
      recipient: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
      token: "USDC",
      amount: "100.00",
    },
    settlement: {
      chainId: 5042002,
      txHash: "0xaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd" as Hex,
      blockNumber: "12345",
      settledAt: "2025-06-01T12:00:00.000Z",
      settlementEvent: {
        contract: "0x8c535227ed2b2963a3c1176510bc59e7a7fef07d" as Address,
        settlementId: "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
        eventTopic: "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex,
        logIndex: 3,
      },
    },
  };
}

// ---------- Canonicalization ----------

describe("PSP Canonicalization", () => {
  it("builds the correct domain separator for testnet", () => {
    expect(buildDomainSeparator("testnet")).toBe("DISBURSE-PSP-v1\ntestnet\n");
  });

  it("builds the correct domain separator for mainnet", () => {
    expect(buildDomainSeparator("mainnet")).toBe("DISBURSE-PSP-v1\nmainnet\n");
  });

  it("produces deterministic JSON with sorted keys", () => {
    const a = deterministicStringify({ z: 1, a: 2, m: 3 });
    const b = deterministicStringify({ a: 2, m: 3, z: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"m":3,"z":1}');
  });

  it("omits undefined and null values", () => {
    const result = deterministicStringify({ a: 1, b: undefined, c: null });
    expect(result).toBe('{"a":1}');
  });

  it("handles nested objects with sorted keys", () => {
    const result = deterministicStringify({
      outer: { z: "last", a: "first" },
      alpha: 1,
    });
    expect(result).toBe('{"alpha":1,"outer":{"a":"first","z":"last"}}');
  });

  it("lowercases hex values during canonicalization", () => {
    // deterministicStringify is a raw serializer — normalization happens via
    // normalizeValue which is applied in canonicalBytes. Test the full path:
    const obj = { hash: "0xAABBCC", name: "Keep Case" };
    // Raw stringify preserves case
    const raw = deterministicStringify(obj);
    expect(raw).toBe('{"hash":"0xAABBCC","name":"Keep Case"}');

    // Through canonicalBytes, hex is lowercased (normalization applied)
    const core: PspCore = {
      version: 1,
      networkMode: "testnet",
      issuer: {
        name: "Test",
        url: "https://test.com",
        publicKey: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" as Address,
      },
      invoice: {
        requestId: "test-id",
        label: "Test",
        payer: "0xAAAABBBBCCCCDDDDAAAABBBBCCCCDDDDAAAABBBB" as Address,
        recipient: "0x1111222233334444555566667777888899990000" as Address,
        token: "USDC",
        amount: "10.00",
      },
      settlement: {
        chainId: 1,
        txHash: "0xAABBCCDDAABBCCDDAABBCCDDAABBCCDDAABBCCDDAABBCCDDAABBCCDDAABBCCDD" as Hex,
        blockNumber: "1",
        settledAt: "2025-01-01T00:00:00.000Z",
        settlementEvent: {
          contract: "0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF" as Address,
          settlementId: "0xFFFF" as Hex,
          eventTopic: "0xEEEE" as Hex,
          logIndex: 0,
        },
      },
    };
    const bytes = new TextDecoder().decode(canonicalBytes(core));
    // All hex/address values should be lowercased in the canonical output
    expect(bytes).toContain("0xaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd");
    expect(bytes).toContain("0xabcdef1234567890abcdef1234567890abcdef12");
    expect(bytes).not.toContain("0xAABB");
  });

  it("preserves array order", () => {
    const result = deterministicStringify({ items: [3, 1, 2] });
    expect(result).toBe('{"items":[3,1,2]}');
  });

  it("produces identical bytes for same core regardless of field order", () => {
    const { address } = createTestKey();
    const core = createTestCore(address);

    // Manually reorder top-level fields
    const reordered = {
      settlement: core.settlement,
      version: core.version,
      issuer: core.issuer,
      networkMode: core.networkMode,
      invoice: core.invoice,
    } as PspCore;

    const bytesA = canonicalBytes(core);
    const bytesB = canonicalBytes(reordered);
    expect(Buffer.from(bytesA).toString("hex")).toBe(Buffer.from(bytesB).toString("hex"));
  });

  it("produces a valid keccak256 digest", () => {
    const { address } = createTestKey();
    const core = createTestCore(address);
    const digest = computeDigest(core);

    expect(digest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("digest changes when any field changes", () => {
    const { address } = createTestKey();
    const core = createTestCore(address);
    const digest1 = computeDigest(core);

    const modified = { ...core, invoice: { ...core.invoice, amount: "200.00" } };
    const digest2 = computeDigest(modified);

    expect(digest1).not.toBe(digest2);
  });

  it("extractCore strips non-core fields", () => {
    const { address } = createTestKey();
    const core = createTestCore(address);
    const full = {
      ...core,
      digest: "0xdeadbeef" as Hex,
      signature: { alg: "secp256k1-keccak256" as const, value: "0x00" as Hex },
      uid: "psp:deadbeef12345678",
      createdAt: "2025-06-01T12:00:00.000Z",
    } as PspV1;

    const extracted = extractCore(full);
    expect(extracted).not.toHaveProperty("digest");
    expect(extracted).not.toHaveProperty("signature");
    expect(extracted).not.toHaveProperty("uid");
    expect(extracted).not.toHaveProperty("createdAt");
    expect(extracted.version).toBe(1);
    expect(extracted.invoice.requestId).toBe(core.invoice.requestId);
  });
});

// ---------- Signing ----------

describe("PSP Signing", () => {
  it("signPsp produces a valid digest and signature", async () => {
    const { privateKey, address } = createTestKey();
    const core = createTestCore(address);

    const result = await signPsp(core, privateKey);
    expect(result.digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.signature.alg).toBe("secp256k1-keccak256");
    expect(result.signature.value).toMatch(/^0x[0-9a-f]+$/);
    expect(result.issuerAddress.toLowerCase()).toBe(address.toLowerCase());
  });

  it("buildSignedPsp produces a complete PspV1", async () => {
    const { privateKey, address } = createTestKey();
    const core = createTestCore(address);

    const psp = await buildSignedPsp(core, privateKey);
    expect(psp.uid).toMatch(/^psp:[0-9a-f]{16}$/);
    expect(psp.createdAt).toBeTruthy();
    expect(psp.digest).toBe(computeDigest(core));
    expect(psp.version).toBe(1);
  });

  it("buildSignedPsp rejects mismatched issuer publicKey", async () => {
    const { privateKey } = createTestKey();
    const { address: otherAddress } = createTestKey();
    const core = createTestCore(otherAddress); // different address than signing key

    await expect(buildSignedPsp(core, privateKey)).rejects.toThrow(
      /does not match signing key address/
    );
  });

  it("verifyPspSignature succeeds for valid PSP", async () => {
    const { privateKey, address } = createTestKey();
    const core = createTestCore(address);
    const psp = await buildSignedPsp(core, privateKey);

    const result = await verifyPspSignature(psp);
    expect(result.ok).toBe(true);
    expect(result.recoveredAddress?.toLowerCase()).toBe(address.toLowerCase());
  });

  it("verifyPspSignature fails when digest is tampered", async () => {
    const { privateKey, address } = createTestKey();
    const core = createTestCore(address);
    const psp = await buildSignedPsp(core, privateKey);

    const tampered = {
      ...psp,
      digest: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
    };

    const result = await verifyPspSignature(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Digest mismatch");
  });

  it("verifyPspSignature fails when invoice is tampered", async () => {
    const { privateKey, address } = createTestKey();
    const core = createTestCore(address);
    const psp = await buildSignedPsp(core, privateKey);

    const tampered = {
      ...psp,
      invoice: { ...psp.invoice, amount: "999.99" },
    };

    const result = await verifyPspSignature(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Digest mismatch");
  });

  it("signature is deterministic for same input", async () => {
    const { privateKey, address } = createTestKey();
    const core = createTestCore(address);

    const sig1 = await signPsp(core, privateKey);
    const sig2 = await signPsp(core, privateKey);

    // secp256k1 signing with the same key and message is deterministic (RFC 6979)
    expect(sig1.signature.value).toBe(sig2.signature.value);
    expect(sig1.digest).toBe(sig2.digest);
  });
});

// ---------- Verification ----------

describe("PSP Verification", () => {
  it("verify succeeds for a valid PSP", async () => {
    const { privateKey, address } = createTestKey();
    const core = createTestCore(address);
    const psp = await buildSignedPsp(core, privateKey);

    const result = await verify(psp);
    expect(result.ok).toBe(true);
    expect(result.fields?.requestId).toBe(core.invoice.requestId);
    expect(result.fields?.payer.toLowerCase()).toBe(core.invoice.payer.toLowerCase());
    expect(result.fields?.recipient.toLowerCase()).toBe(core.invoice.recipient.toLowerCase());
    expect(result.fields?.issuer.toLowerCase()).toBe(address.toLowerCase());
    expect(result.fields?.networkMode).toBe("testnet");
  });

  it("verify rejects non-object input", async () => {
    const result = await verify("not an object");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("non-null object");
  });

  it("verify rejects unsupported version", async () => {
    const result = await verify({ version: 2 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("version");
  });

  it("verify rejects invalid networkMode", async () => {
    const result = await verify({ version: 1, networkMode: "devnet" });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("networkMode");
  });

  it("verify rejects tampered amount", async () => {
    const { privateKey, address } = createTestKey();
    const core = createTestCore(address);
    const psp = await buildSignedPsp(core, privateKey);

    const tampered = { ...psp, invoice: { ...psp.invoice, amount: "0.01" } };
    const result = await verify(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Digest mismatch");
  });

  it("verify rejects tampered recipient", async () => {
    const { privateKey, address } = createTestKey();
    const core = createTestCore(address);
    const psp = await buildSignedPsp(core, privateKey);

    const tampered = {
      ...psp,
      invoice: {
        ...psp.invoice,
        recipient: "0x0000000000000000000000000000000000000001" as Address,
      },
    };
    const result = await verify(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Digest mismatch");
  });

  it("verify rejects wrong UID", async () => {
    const { privateKey, address } = createTestKey();
    const core = createTestCore(address);
    const psp = await buildSignedPsp(core, privateKey);

    const tampered = { ...psp, uid: "psp:0000000000000000" };
    const result = await verify(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("UID mismatch");
  });

  it("verify with expectedIssuer passes for correct issuer", async () => {
    const { privateKey, address } = createTestKey();
    const core = createTestCore(address);
    const psp = await buildSignedPsp(core, privateKey);

    const result = await verify(psp, { expectedIssuer: address });
    expect(result.ok).toBe(true);
  });

  it("verify with expectedIssuer fails for wrong issuer", async () => {
    const { privateKey, address } = createTestKey();
    const { address: otherAddress } = createTestKey();
    const core = createTestCore(address);
    const psp = await buildSignedPsp(core, privateKey);

    const result = await verify(psp, { expectedIssuer: otherAddress });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Issuer mismatch");
  });

  it("verifyJson round-trips from JSON string", async () => {
    const { privateKey, address } = createTestKey();
    const core = createTestCore(address);
    const psp = await buildSignedPsp(core, privateKey);

    const json = JSON.stringify(psp);
    const result = await verifyJson(json);
    expect(result.ok).toBe(true);
    expect(result.fields?.requestId).toBe(core.invoice.requestId);
  });

  it("verifyJson rejects malformed JSON", async () => {
    const result = await verifyJson("{ not valid json }}}");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("JSON parse");
  });

  it("cross-chain PSP with source field verifies correctly", async () => {
    const { privateKey, address } = createTestKey();
    const core: PspCore = {
      ...createTestCore(address),
      source: {
        chainId: 84532,
        txHash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hex,
        blockNumber: "98765",
        payer: "0x1234567890123456789012345678901234567890" as Address,
        token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
        amount: "100000000",
      },
    };

    const psp = await buildSignedPsp(core, privateKey);
    const result = await verify(psp);
    expect(result.ok).toBe(true);
  });
});
