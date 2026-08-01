/**
 * PSP — Issuance
 *
 * Builds and persists a Portable Settlement Proof. Idempotent on the
 * payment request id. Called after the underlying event reaches terminal state.
 *
 * Failures are non-fatal to the parent flow — they are logged but never
 * roll back a confirmed payment or a successful claim.
 */

import {
  getAddress,
  isAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { ARC_CHAIN_ID, publicClient } from "../../src/lib/arc.js";
import { isRemotePaymentSourceChainId } from "../../src/lib/crosschain.js";
import { isCrossChainPaymentRequest, type PaymentRequest, type Receipt } from "../../src/lib/payments.js";
import {
  buildPspClaimFields,
  computePspClaimDomainSeparator,
  PSP_CLAIM_TYPEHASH,
} from "../../src/lib/psp/claim.js";
import {
  attachPspOnchainClaim,
  buildSignedPsp,
  verifyPspSignature,
} from "../../src/lib/psp/sign.js";
import { computeDigest } from "../../src/lib/psp/canonical.js";
import type { NetworkMode, PspCore, PspV1 } from "../../src/lib/psp/types.js";
import {
  readCrossChainSettlementLog,
  readDirectSettlementLog,
  readSourcePaymentLog,
} from "./fetchLogs.js";
import { getSupabaseAdmin } from "../supabase.js";
import { HttpError } from "../http.js";

// ---------- Configuration ----------

const PSP_ISSUER_NAME = "Disburse";
const PSP_ISSUER_URL = "https://disburse.app";
const UINT64_MAX = 18_446_744_073_709_551_615n;

const PSP_VERIFIER_ABI = [
  {
    type: "function",
    name: "VERIFIER_VERSION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ARC_TESTNET_CHAIN_ID",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "PSP_FIELDS_TYPEHASH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "domainSeparator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "trustedIssuers",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "settlementRegistrations",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "version", type: "uint64" },
      { name: "enabled", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "verifyDirectClaim",
    stateMutability: "view",
    inputs: [
      {
        name: "fields",
        type: "tuple",
        components: [
          { name: "documentDigest", type: "bytes32" },
          { name: "networkMode", type: "string" },
          { name: "verificationMode", type: "string" },
          { name: "settlementContract", type: "address" },
          { name: "settlementRegistryVersion", type: "uint64" },
          { name: "settlementId", type: "bytes32" },
          { name: "invoicePayer", type: "address" },
          { name: "invoiceRecipient", type: "address" },
          { name: "invoiceToken", type: "string" },
          { name: "invoiceAmount", type: "string" },
          { name: "requestId", type: "string" },
          { name: "settlementChainId", type: "uint256" },
          { name: "settlementTxHash", type: "bytes32" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [
      { name: "ok", type: "bool" },
      { name: "recoveredSigner", type: "address" },
    ],
  },
  {
    type: "function",
    name: "verifySettlementClaim",
    stateMutability: "view",
    inputs: [
      {
        name: "fields",
        type: "tuple",
        components: [
          { name: "documentDigest", type: "bytes32" },
          { name: "networkMode", type: "string" },
          { name: "verificationMode", type: "string" },
          { name: "settlementContract", type: "address" },
          { name: "settlementRegistryVersion", type: "uint64" },
          { name: "settlementId", type: "bytes32" },
          { name: "invoicePayer", type: "address" },
          { name: "invoiceRecipient", type: "address" },
          { name: "invoiceToken", type: "string" },
          { name: "invoiceAmount", type: "string" },
          { name: "requestId", type: "string" },
          { name: "settlementChainId", type: "uint256" },
          { name: "settlementTxHash", type: "bytes32" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [
      { name: "ok", type: "bool" },
      { name: "recoveredSigner", type: "address" },
    ],
  },
] as const;

function getPspSigningKey(): Hex {
  const key = process.env.DISBURSE_PSP_SIGNING_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("DISBURSE_PSP_SIGNING_KEY is not configured or invalid.");
  }
  return key as Hex;
}

function getNetworkMode(): NetworkMode {
  const mode = process.env.PSP_NETWORK_MODE || "testnet";
  // This server's RPC, token addresses, and settlement readers are all pinned
  // to Arc Testnet. Accepting "mainnet" would sign a semantically false claim.
  if (mode !== "testnet") {
    throw new Error(
      `PSP_NETWORK_MODE must be testnet for Arc chain ${ARC_CHAIN_ID}.`
    );
  }
  return "testnet";
}

function getSettlementContract(): Address {
  const addr = process.env.ARC_SETTLEMENT_CONTRACT?.trim();
  if (!addr || !isAddress(addr) || getAddress(addr) === zeroAddress) {
    throw new Error(
      "ARC_SETTLEMENT_CONTRACT is not configured as a non-zero EVM address."
    );
  }
  return getAddress(addr);
}

type PspVerifierConfig = {
  address: Address;
  settlementRegistryVersion?: number;
};

function getPspVerifierConfig(): PspVerifierConfig | null {
  const requiredValue = process.env.PSP_REQUIRE_ONCHAIN_CLAIM;
  if (
    requiredValue !== undefined &&
    requiredValue !== "0" &&
    requiredValue !== "1"
  ) {
    throw new Error("PSP_REQUIRE_ONCHAIN_CLAIM must be either 0 or 1.");
  }

  const addressValue = process.env.PSP_VERIFIER_V2_ADDRESS?.trim();
  const versionValue =
    process.env.PSP_SETTLEMENT_REGISTRY_VERSION?.trim();
  if (!addressValue) {
    if (versionValue) {
      throw new Error(
        "PSP_SETTLEMENT_REGISTRY_VERSION requires PSP_VERIFIER_V2_ADDRESS."
      );
    }
    if (requiredValue === "1") {
      throw new Error(
        "PSP_REQUIRE_ONCHAIN_CLAIM=1 requires PSP_VERIFIER_V2_ADDRESS."
      );
    }
    return null;
  }
  if (
    !isAddress(addressValue) ||
    getAddress(addressValue) === zeroAddress
  ) {
    throw new Error(
      "PSP_VERIFIER_V2_ADDRESS must be a non-zero EVM address."
    );
  }

  let settlementRegistryVersion: number | undefined;
  if (versionValue) {
    if (!/^[1-9][0-9]*$/.test(versionValue)) {
      throw new Error(
        "PSP_SETTLEMENT_REGISTRY_VERSION must be a positive decimal integer."
      );
    }
    const parsed = BigInt(versionValue);
    if (parsed > UINT64_MAX || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        "PSP_SETTLEMENT_REGISTRY_VERSION is outside the supported uint64 safe-integer range."
      );
    }
    settlementRegistryVersion = Number(parsed);
  }

  return {
    address: getAddress(addressValue),
    settlementRegistryVersion,
  };
}

// ---------- Public API ----------

export type IssuePspResult = {
  psp: PspV1;
  isNew: boolean;
  claimStatus: "v2_attached" | "legacy_offline_only";
};

/**
 * Context for PSP issuance: a terminal-state PaymentRequest + Receipt.
 * Persisted with the request_id idempotency key.
 */
export type IssueContext = { kind: "payment"; request: PaymentRequest; receipt: Receipt };

/**
 * Issue a PSP for a payment. Idempotent on the request id.
 */
export async function issuePsp(ctx: IssueContext): Promise<IssuePspResult> {
  return issuePaymentPsp(ctx.request, ctx.receipt);
}

// ---------- Payment issuance (existing v1 path) ----------

async function issuePaymentPsp(
  request: PaymentRequest,
  receipt: Receipt
): Promise<IssuePspResult> {
  const supabase = getSupabaseAdmin();
  const verifierConfig = getPspVerifierConfig();
  const isCrossChain = classifyPaymentRail(request, receipt);
  if (
    isCrossChain &&
    verifierConfig &&
    !verifierConfig.settlementRegistryVersion
  ) {
    throw new Error(
      "Cross-chain PSP v2 issuance requires PSP_SETTLEMENT_REGISTRY_VERSION."
    );
  }

  const signingKey = getPspSigningKey();
  const networkMode = getNetworkMode();
  // Cross-chain settlement (a QrPaymentSettled event on the Arc settlement
  // contract) only happens when funds originate on a genuinely *remote* source
  // chain. arc_settlement requests paid directly on Arc (source == dest == Arc)
  // settle with a plain USDC Transfer instead, so they must be read with
  // readDirectSettlementLog. isCrossChainPaymentRequest() is true for both, so
  // it alone is not enough — gate on the source actually being a remote chain.
  let settlement: PspCore["settlement"];
  let source: PspCore["source"];
  if (isCrossChain && isRemotePaymentSourceChainId(receipt.sourceChainId)) {
    const sourceContractValue = process.env[
      `SOURCE_CONTRACT_${receipt.sourceChainId}`
    ]?.trim();

    if (
      !sourceContractValue ||
      !isAddress(sourceContractValue) ||
      getAddress(sourceContractValue) === zeroAddress
    ) {
      throw new Error(
        `SOURCE_CONTRACT_${receipt.sourceChainId} must be a non-zero EVM address for cross-chain PSP issuance.`
      );
    }
    const sourceContract = getAddress(sourceContractValue);
    const sourceResult = await readSourcePaymentLog(
      receipt,
      request,
      sourceContract
    );
    const settlementResult = await readCrossChainSettlementLog(
      receipt,
      request,
      getSettlementContract(),
      sourceResult.evidence
    );
    source = sourceResult.source;
    settlement = settlementResult.settlement;
  } else {
    settlement = (await readDirectSettlementLog(receipt, request)).settlement;
  }

  // Derive issuer address from signing key
  const { privateKeyToAccount } = await import("viem/accounts");
  const issuerAccount = privateKeyToAccount(signingKey);

  const core: PspCore = {
    version: 1,
    networkMode,
    issuer: {
      name: PSP_ISSUER_NAME,
      url: PSP_ISSUER_URL,
      publicKey: issuerAccount.address,
    },
    invoice: {
      requestId: request.id,
      label: request.label,
      invoiceDate: request.invoiceDate,
      note: request.note,
      payer: receipt.from,
      recipient: receipt.to,
      token: request.token,
      amount: request.amount,
    },
    settlement,
    ...(source ? { source } : {}),
  };

  // Existing proofs are not trusted merely because they occupy the
  // idempotency slot. Re-read exact chain evidence above, then require the
  // stored proof to be the same signed core before returning it.
  const { data: existing, error: existingError } = await supabase
    .from("psp_documents")
    .select("document")
    .eq("request_id", request.id)
    .maybeSingle();
  if (existingError) {
    throw new HttpError(500, "Portable Settlement Proof could not be loaded.");
  }
  if (existing?.document) {
    const existingPsp = existing.document as unknown as PspV1;
    await assertExistingPspMatchesEvidence(
      existingPsp,
      core,
      issuerAccount.address,
      signingKey,
      verifierConfig,
      isCrossChain
    );
    return {
      psp: existingPsp,
      isNew: false,
      claimStatus: existingPsp.onchainClaim
        ? "v2_attached"
        : "legacy_offline_only",
    };
  }

  // Sign and build the full PSP document
  const portablePsp = await buildSignedPsp(core, signingKey);
  const psp = verifierConfig
    ? await attachAndValidateV2Claim(
        portablePsp,
        signingKey,
        verifierConfig,
        isCrossChain
      )
    : portablePsp;

  // Persist to database
  const { error: insertError } = await supabase.from("psp_documents").upsert(
    {
      uid: psp.uid,
      request_id: request.id,
      network_mode: networkMode,
      digest: psp.digest,
      document: psp as unknown as Record<string, unknown>,
      issuer_public_key: issuerAccount.address.toLowerCase(),
      signature: psp.signature.value,
      created_at: psp.createdAt,
    },
    { onConflict: "request_id" }
  );

  if (insertError) {
    throw new HttpError(500, "Portable Settlement Proof could not be persisted.");
  }

  // Log the event (non-fatal if this fails)
  try {
    await supabase.from("payment_request_events").insert({
      request_id: request.id,
      event_type: "psp_issue",
      status: request.status,
      message: psp.onchainClaim
        ? `Portable Settlement Proof issued with PspVerifier v2 ${psp.onchainClaim.mode} claim: ${psp.uid}`
        : `Portable Settlement Proof issued for trusted offline verification only: ${psp.uid}`,
      tx_hash: receipt.txHash,
    });
  } catch {
    // Non-fatal — PSP was persisted successfully
  }

  return {
    psp,
    isNew: true,
    claimStatus: psp.onchainClaim
      ? "v2_attached"
      : "legacy_offline_only",
  };
}

function classifyPaymentRail(
  request: PaymentRequest,
  receipt: Receipt
): boolean {
  const receiptHasRemoteChain = isRemotePaymentSourceChainId(
    receipt.sourceChainId
  );
  const requestHasRemoteSettlement = isRemotePaymentSourceChainId(
    request.settlement?.sourceChainId
  );
  const hasAnyRemoteEvidence =
    receiptHasRemoteChain ||
    Boolean(receipt.sourceTxHash) ||
    requestHasRemoteSettlement ||
    Boolean(request.settlement?.sourceTxHash);

  if (!hasAnyRemoteEvidence) {
    return false;
  }
  if (
    !isCrossChainPaymentRequest(request) ||
    !receiptHasRemoteChain ||
    !receipt.sourceTxHash
  ) {
    throw new Error(
      "Incomplete remote settlement evidence cannot be issued as a direct PSP."
    );
  }
  return true;
}

async function assertExistingPspMatchesEvidence(
  existingPsp: PspV1,
  expectedCore: PspCore,
  expectedIssuer: Address,
  signingKey: Hex,
  verifierConfig: PspVerifierConfig | null,
  isCrossChain: boolean
): Promise<void> {
  const expectedDigest = computeDigest(expectedCore);
  const expectedUid = `psp:${expectedDigest.slice(2, 18)}`;
  if (
    existingPsp.digest?.toLowerCase() !== expectedDigest.toLowerCase() ||
    existingPsp.uid !== expectedUid ||
    existingPsp.issuer?.publicKey?.toLowerCase() !==
      expectedIssuer.toLowerCase()
  ) {
    throw new Error(
      "Existing PSP does not match the currently validated payment evidence."
    );
  }

  const signatureResult = await verifyPspSignature(existingPsp);
  if (
    !signatureResult.ok ||
    signatureResult.recoveredAddress?.toLowerCase() !==
      expectedIssuer.toLowerCase()
  ) {
    throw new Error(
      `Existing PSP failed issuer signature validation: ${signatureResult.reason ?? "unexpected signer"}.`
    );
  }

  if (!verifierConfig) {
    return;
  }
  if (!existingPsp.onchainClaim) {
    throw new Error(
      `Existing PSP ${existingPsp.uid} is a legacy offline-only proof without a v2 claim; use an explicit audited re-attestation flow.`
    );
  }

  // Recreate the claim only after checking current verifier bytecode,
  // fingerprint, registry, and issuer trust. viem signing is deterministic, so
  // equality also proves the stored claim was not substituted after issuance.
  const { onchainClaim: _discardedClaim, ...portable } = existingPsp;
  const expectedClaimedPsp = await attachAndValidateV2Claim(
    portable as PspV1,
    signingKey,
    verifierConfig,
    isCrossChain
  );
  if (
    JSON.stringify(existingPsp.onchainClaim) !==
    JSON.stringify(expectedClaimedPsp.onchainClaim)
  ) {
    throw new Error(
      `Existing PSP ${existingPsp.uid} on-chain claim does not match the configured verifier and validated evidence.`
    );
  }
}

async function attachAndValidateV2Claim(
  psp: PspV1,
  signingKey: Hex,
  config: PspVerifierConfig,
  isCrossChain: boolean
): Promise<PspV1> {
  if (psp.settlement.chainId !== ARC_CHAIN_ID) {
    throw new Error(
      `PSP settlement chain ${psp.settlement.chainId} does not match Arc chain ${ARC_CHAIN_ID}.`
    );
  }

  const mode = isCrossChain
    ? "settlement" as const
    : "direct-signature-only" as const;
  if (mode === "settlement" && !config.settlementRegistryVersion) {
    throw new Error(
      "Cross-chain PSP v2 issuance requires PSP_SETTLEMENT_REGISTRY_VERSION."
    );
  }

  const rpcChainId = await publicClient.getChainId();
  if (rpcChainId !== ARC_CHAIN_ID) {
    throw new Error(
      `Arc RPC chain mismatch during PSP issuance: expected ${ARC_CHAIN_ID}, got ${rpcChainId}.`
    );
  }

  const verifierCode = await publicClient.getCode({
    address: config.address,
  });
  if (!verifierCode || verifierCode === "0x") {
    throw new Error(
      `PSP_VERIFIER_V2_ADDRESS ${config.address} has no bytecode on Arc Testnet.`
    );
  }

  const [
    verifierVersion,
    verifierArcChainId,
    fieldsTypehash,
    domainSeparator,
    issuerTrusted,
  ] =
    await Promise.all([
      publicClient.readContract({
        address: config.address,
        abi: PSP_VERIFIER_ABI,
        functionName: "VERIFIER_VERSION",
      }),
      publicClient.readContract({
        address: config.address,
        abi: PSP_VERIFIER_ABI,
        functionName: "ARC_TESTNET_CHAIN_ID",
      }),
      publicClient.readContract({
        address: config.address,
        abi: PSP_VERIFIER_ABI,
        functionName: "PSP_FIELDS_TYPEHASH",
      }),
      publicClient.readContract({
        address: config.address,
        abi: PSP_VERIFIER_ABI,
        functionName: "domainSeparator",
      }),
      publicClient.readContract({
        address: config.address,
        abi: PSP_VERIFIER_ABI,
        functionName: "trustedIssuers",
        args: [psp.issuer.publicKey],
      }),
    ]);

  if (verifierVersion !== 2n) {
    throw new Error(
      `Configured PSP verifier reports unsupported version ${verifierVersion}.`
    );
  }
  if (verifierArcChainId !== BigInt(ARC_CHAIN_ID)) {
    throw new Error(
      `Configured PSP verifier targets unsupported Arc chain ${verifierArcChainId}.`
    );
  }
  if (fieldsTypehash.toLowerCase() !== PSP_CLAIM_TYPEHASH.toLowerCase()) {
    throw new Error(
      "Configured PSP verifier has an unexpected PspFields typehash."
    );
  }
  const expectedDomainSeparator = computePspClaimDomainSeparator(
    ARC_CHAIN_ID,
    config.address
  );
  if (
    domainSeparator.toLowerCase() !== expectedDomainSeparator.toLowerCase()
  ) {
    throw new Error(
      "Configured PSP verifier has an unexpected EIP-712 domain separator."
    );
  }
  if (!issuerTrusted) {
    throw new Error(
      `PSP issuer ${psp.issuer.publicKey} is not enabled in PspVerifier v2.`
    );
  }

  if (mode === "settlement") {
    const [registeredVersion, enabled] = await publicClient.readContract({
      address: config.address,
      abi: PSP_VERIFIER_ABI,
      functionName: "settlementRegistrations",
      args: [psp.settlement.settlementEvent.contract],
    });
    if (
      !enabled ||
      registeredVersion !== BigInt(config.settlementRegistryVersion!)
    ) {
      throw new Error(
        `Settlement contract ${psp.settlement.settlementEvent.contract} is not enabled as registry version ${config.settlementRegistryVersion}.`
      );
    }
  }

  // Only sign after the configured verifier's code and EIP-712 fingerprint
  // have matched the v2 implementation.
  const claimedPsp = await attachPspOnchainClaim(psp, signingKey, {
    verifierAddress: config.address,
    chainId: ARC_CHAIN_ID,
    mode,
    settlementRegistryVersion:
      mode === "settlement" ? config.settlementRegistryVersion : undefined,
  });
  const claim = claimedPsp.onchainClaim!;
  const fields = buildPspClaimFields(
    claimedPsp,
    mode,
    claim.settlementRegistryVersion
  );

  const [ok, recoveredSigner] = await publicClient.readContract({
    address: config.address,
    abi: PSP_VERIFIER_ABI,
    functionName:
      mode === "settlement"
        ? "verifySettlementClaim"
        : "verifyDirectClaim",
    args: [fields, claim.signature],
  });
  if (
    !ok ||
    recoveredSigner.toLowerCase() !==
      claimedPsp.issuer.publicKey.toLowerCase()
  ) {
    throw new Error(
      mode === "settlement"
        ? "PspVerifier v2 did not confirm the newly signed settlement claim."
        : "PspVerifier v2 did not accept the newly signed direct signature-only claim."
    );
  }

  return claimedPsp;
}

// ---------- Reads ----------

/**
 * Read an existing PSP by UID.
 */
export async function readPspByUid(uid: string): Promise<PspV1 | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("psp_documents")
    .select("document")
    .eq("uid", uid)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "Portable Settlement Proof could not be loaded.");
  }

  return data?.document ? (data.document as unknown as PspV1) : null;
}

/**
 * Read an existing PSP by payment request ID.
 */
export async function readPspByRequestId(requestId: string): Promise<PspV1 | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("psp_documents")
    .select("document")
    .eq("request_id", requestId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "Portable Settlement Proof could not be loaded.");
  }

  return data?.document ? (data.document as unknown as PspV1) : null;
}
