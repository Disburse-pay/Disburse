import { constants } from "node:fs";
import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createWalletClient,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hash
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ARC_CHAIN_ID,
  ARC_EXPLORER_URL,
  ARC_RPC_ENDPOINTS,
  TOKENS,
  arcTestnet,
  createArcPublicClient,
  erc20Abi
} from "./lib/arc.js";
import {
  formatTokenAmount,
  getConfirmedTransferFromReceipt,
  makeReceipt,
  normalizeInvoiceDate,
  normalizeLabel,
  normalizeNote,
  parseTokenAmount,
  validateRecipient,
  type PaymentToken,
  type Receipt
} from "./lib/payments.js";
import {
  buildInvoiceFilename,
  generateInvoicePdf,
  type InvoiceInput
} from "./lib/invoice.js";
import {
  authorizeExecution,
  type ConfirmationCallback,
  type SendPreview
} from "./safety.js";

export type SendOptions = {
  recipient: string;
  amount: string;
  label: string;
  note?: string;
  invoiceDate?: string;
  token?: PaymentToken;
  privateKey: `0x${string}`;
  outDir?: string;
  rpc?: string;
  yes?: boolean;
  dryRun?: boolean;
  confirm?: ConfirmationCallback;
  /** Independently trusted PSP issuer. Never infer this from the returned PSP. */
  trustedPspIssuer?: string;
  json?: boolean;
};

export type SendCompletedResult = {
  success: true;
  txHash: Hash;
  psp: unknown;
  proofPath: string;
  pdfPath: string;
  explorer: string;
  pspUid?: string;
  requestId?: string;
  amount: string;
  token: PaymentToken;
  recipient: Address;
  label: string;
  note?: string;
  verify?: {
    file: string;
    curl?: string;
  };
};

export type SendDryRunResult = {
  success: true;
  dryRun: true;
  preview: SendPreview;
};

export type SendPostBroadcastFailureResult = {
  success: false;
  broadcast: true;
  confirmed: boolean;
  txHash: Hash;
  explorer: string;
  recoveryPath: string;
  stage: "journal" | "confirmation" | "registration" | "artifacts";
  error: string;
  retryGuidance: string;
  amount: string;
  token: PaymentToken;
  recipient: string;
  label: string;
};

export type SendResult = SendCompletedResult | SendDryRunResult | SendPostBroadcastFailureResult;

const DEFAULT_API_BASE = "https://app.disburse.online";
const TRUSTED_ISSUER_ENV_REFERENCE = "$DISBURSE_TRUSTED_PSP_ISSUER";

function getApiBase(): string {
  // Mirror the pattern used by psp-viewer for stable public URLs
  return process.env.PSP_PUBLIC_URL || DEFAULT_API_BASE;
}

export async function send(opts: SendOptions): Promise<SendResult> {
  const token = (opts.token || "USDC") as PaymentToken;
  if (token !== "USDC" && token !== "EURC") {
    throw new Error("token must be USDC or EURC");
  }

  const recipient = validateRecipient(opts.recipient);
  const amount = formatTokenAmount(parseTokenAmount(opts.amount, token), token);
  const label = normalizeLabel(opts.label);
  const note = opts.note ? normalizeNote(opts.note) : undefined;
  const invoiceDate = opts.invoiceDate ? normalizeInvoiceDate(opts.invoiceDate) : undefined;
  const trustedPspIssuer = opts.trustedPspIssuer
    ? normalizeTrustedPspIssuer(opts.trustedPspIssuer)
    : undefined;

  const pk = opts.privateKey;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error("privateKey must be 0x + 64 hex characters");
  }

  const account = privateKeyToAccount(pk);
  const payer = account.address;

  const rpcUrl = opts.rpc || ARC_RPC_ENDPOINTS[0].url;
  const pub = createArcPublicClient(rpcUrl);
  const wallet = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(rpcUrl, { timeout: 15_000 })
  });

  const tokenInfo = TOKENS[token];
  const tokenAddr = tokenInfo.address;

  // Basic balance check (non-fatal if it fails — the node will reject later)
  try {
    const bal = await pub.readContract({
      address: tokenAddr,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [payer]
    });
    const needed = parseTokenAmount(opts.amount, token);
    if (bal < needed) {
      throw new Error(`Insufficient ${token} balance. Have ${formatTokenAmount(bal, token)}, need ${amount}.`);
    }
  } catch (e) {
    // Continue — the actual send will surface precise errors
    if (e instanceof Error && e.message.includes("Insufficient")) throw e;
  }

  // Send the transfer
  const amountUnits = parseTokenAmount(opts.amount, token);
  const preview: SendPreview = {
    kind: "send",
    chainId: ARC_CHAIN_ID,
    payer,
    recipient,
    token,
    tokenAddress: tokenAddr,
    amount,
    label,
    rpcUrl
  };
  const authorization = await authorizeExecution(preview, opts);
  if (authorization === "dry-run") {
    log(opts, "Dry run complete. No transaction was broadcast.");
    return { success: true, dryRun: true, preview };
  }

  const outDir = resolve(opts.outDir || process.cwd());
  await access(outDir, constants.W_OK);

  const hash = await wallet.writeContract({
    address: tokenAddr,
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, amountUnits],
    gas: 80_000n // safe over-estimate for simple ERC-20 on Arc
  });

  const explorer = `${ARC_EXPLORER_URL}/tx/${hash}`;
  const recoveryPath = resolve(outDir, `disburse-recovery-${hash.slice(2, 10)}.json`);
  let recoveryStage: SendPostBroadcastFailureResult["stage"] = "journal";
  let confirmed = false;

  try {
    await writeRecoveryJournal(recoveryPath, {
      state: "broadcast",
      txHash: hash,
      explorer,
      payer,
      recipient,
      token,
      amount,
      label,
      submittedAt: new Date().toISOString()
    });

    log(opts, `Transaction submitted: ${hash}`);
    log(opts, `Explorer: ${explorer}`);
    log(opts, "Waiting for confirmation (1 block)...");

    recoveryStage = "confirmation";
    const receipt = await pub.waitForTransactionReceipt({ hash, confirmations: 1 });
    const confirmedTransfer = getConfirmedTransferFromReceipt(receipt, {
      hash,
      payer,
      recipient,
      token,
      amount: amountUnits
    });
    const blockNumber = confirmedTransfer.blockNumber.toString();
    confirmed = true;
    await writeRecoveryJournal(recoveryPath, {
      state: "confirmed",
      txHash: hash,
      explorer,
      payer,
      recipient,
      token,
      amount,
      label,
      blockNumber,
      confirmedAt: new Date().toISOString()
    });

    log(opts, `Confirmed in block ${blockNumber}`);

    // Build local receipt for PDF (the server will also verify)
    const localReceipt: Receipt = {
      ...makeReceipt(
        { id: `direct-${hash}`, token },
        confirmedTransfer
      ),
      blockHash: receipt.blockHash
    };

    // Register with Disburse to obtain signed PSP (the source of truth for proofs)
    recoveryStage = "registration";
    const apiBase = getApiBase();
    const registerBody = {
      txHash: hash,
      rail: "direct" as const,
      label,
      note,
      token,
      recipient: recipient,
      amount,
      invoiceDate,
      signature: await account.signTypedData(
        buildDisburseRegistrationTypedData({
          txHash: hash,
          rail: "direct",
          token,
          recipient,
          amount,
          label,
          note,
          invoiceDate
        })
      )
    };

    const regRes = await fetch(`${apiBase}/api/disburse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(registerBody)
    });

    if (!regRes.ok) {
      throw new Error(`PSP registration returned HTTP ${regRes.status}.`);
    }

    const regJson = (await regRes.json()) as { psp?: unknown; error?: string };
    if (!regJson.psp) {
      throw new Error("PSP registration returned no proof document.");
    }
    const psp = regJson.psp;
    recoveryStage = "artifacts";

  // Write proof.json
  const proofPath = resolve(outDir, `disburse-psp-${hash.slice(2, 10)}.json`);
  await writeFile(proofPath, JSON.stringify(psp, null, 2), "utf8");

  // Generate Invoice PDF (with PSP digest in footer)
  const pspDoc = psp as Record<string, unknown> | undefined;
  const pspDigest = (pspDoc?.digest as string | undefined) ?? undefined;
  const pspUid = (pspDoc?.uid as string | undefined) ?? undefined;
  const pspInvoice = pspDoc?.invoice as Record<string, unknown> | undefined;
  const invoiceInput: InvoiceInput = {
    request: {
      id: (pspInvoice?.requestId as string) || `direct-${hash.slice(2, 10)}`,
      recipient: (pspInvoice?.recipient as string) || recipient,
      token,
      amount,
      label,
      note,
      invoiceDate: pspInvoice?.invoiceDate as string | undefined
        ?? invoiceDate
    },
    receipt: localReceipt,
    pspDigest,
    pspUid,
    pspVerifierUrl: apiBase,
    trustedPspIssuer
  };

  const pdfBytes = await generateInvoicePdf(invoiceInput);
  const pdfPath = resolve(outDir, buildInvoiceFilename(invoiceInput));
  await writeFile(pdfPath, Buffer.from(pdfBytes));
  await writeRecoveryJournal(recoveryPath, {
    state: "complete",
    txHash: hash,
    explorer,
    payer,
    recipient,
    token,
    amount,
    label,
    blockNumber,
    proofPath,
    pdfPath,
    completedAt: new Date().toISOString()
  });

  // Success output for agents / humans
  log(opts, "\n✓ Disbursement complete");
  log(opts, `  Tx:        ${hash}`);
  log(opts, `  Explorer:  ${explorer}`);
  log(opts, `  Proof:     ${proofPath}`);
  log(opts, `  Invoice:   ${pdfPath}`);

  const uid = pspUid || (pspDigest ? `psp:${pspDigest.slice(2, 18)}` : undefined);
  const requestId = pspInvoice?.requestId as string | undefined;
  const verify = buildPspVerificationCommands({
    proofPath,
    apiBase,
    uid,
    trustedPspIssuer
  });

  if (uid) {
    log(opts, `  PSP UID:   ${uid}`);
    log(
      opts,
      trustedPspIssuer
        ? `\nVerify against independently configured issuer ${trustedPspIssuer}:`
        : "\nVerify after setting DISBURSE_TRUSTED_PSP_ISSUER from trusted configuration:"
    );
    log(opts, `  ${verify.file}`);
    if (verify.curl) log(opts, `  ${verify.curl}`);
  }

  log(opts, "\nDisburse does not custody funds. Proofs are independently verifiable.");

  return {
    success: true,
    txHash: hash,
    psp,
    proofPath,
    pdfPath,
    explorer,
    pspUid: uid,
    requestId,
    amount,
    token,
    recipient,
    label,
    note,
    verify
  };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeRecoveryJournal(recoveryPath, {
      state: "action_required",
      stage: recoveryStage,
      txHash: hash,
      explorer,
      payer,
      recipient,
      token,
      amount,
      label,
      confirmed,
      error: message,
      updatedAt: new Date().toISOString()
    }).catch(() => undefined);

    const retryGuidance =
      "DO NOT RESEND THIS PAYMENT. Reconcile or register the same transaction hash after the RPC/API/output problem is fixed.";
    log(opts, `\nACTION REQUIRED: ${message}`);
    log(opts, `  Tx:       ${hash}`);
    log(opts, `  Recovery: ${recoveryPath}`);
    log(opts, `  ${retryGuidance}`);

    return {
      success: false,
      broadcast: true,
      confirmed,
      txHash: hash,
      explorer,
      recoveryPath,
      stage: recoveryStage,
      error: message,
      retryGuidance,
      amount,
      token,
      recipient,
      label
    };
  }
}

async function writeRecoveryJournal(path: string, payload: Record<string, unknown>) {
  await writeFile(
    path,
    JSON.stringify(
      {
        kind: "disburse-direct-send-recovery",
        version: 1,
        ...payload
      },
      null,
      2
    ),
    "utf8"
  );
}

function log(opts: Pick<SendOptions, "json">, message: string) {
  if (!opts.json) {
    console.log(message);
  }
}

export function buildPspVerificationCommands(input: {
  proofPath: string;
  apiBase: string;
  uid?: string;
  trustedPspIssuer?: Address;
}): {
  file: string;
  curl?: string;
} {
  const issuerArgument = input.trustedPspIssuer
    ? shellQuote(input.trustedPspIssuer)
    : `"${TRUSTED_ISSUER_ENV_REFERENCE}"`;
  const verifierArguments = `--issuer ${issuerArgument}`;
  const file = `npx @disburse/psp-verify ${shellQuote(input.proofPath)} ${verifierArguments}`;

  if (!input.uid) {
    return { file };
  }

  const endpoint = new URL("/api/psp", ensureTrailingSlash(input.apiBase));
  endpoint.searchParams.set("uid", input.uid);
  return {
    file,
    curl: `curl --fail --silent --show-error ${shellQuote(endpoint.toString())} | npx @disburse/psp-verify --stdin ${verifierArguments}`
  };
}

function normalizeTrustedPspIssuer(value: string): Address {
  const issuer = value.trim();
  if (!isAddress(issuer)) {
    throw new Error("trustedPspIssuer must be a valid 0x EVM address obtained from trusted configuration");
  }
  return getAddress(issuer);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * EIP-712 payload authorizing PSP registration of a direct transfer. Must
 * match buildDisburseRegistrationTypedData in the Disburse API
 * (api-handlers/disburse.ts): domain bound to the app name and Arc chain id
 * so the signature verifies nowhere else.
 */
export function buildDisburseRegistrationTypedData(input: {
  txHash: Hash;
  rail?: "direct";
  token: PaymentToken;
  recipient: Address;
  amount: string;
  label: string;
  note?: string;
  invoiceDate?: string;
}) {
  return {
    domain: { name: "Disburse", version: "1", chainId: ARC_CHAIN_ID },
    types: {
      DirectPspRegistration: [
        { name: "txHash", type: "bytes32" },
        { name: "rail", type: "string" },
        { name: "token", type: "string" },
        { name: "recipient", type: "address" },
        { name: "amount", type: "string" },
        { name: "label", type: "string" },
        { name: "note", type: "string" },
        { name: "invoiceDate", type: "string" }
      ]
    },
    primaryType: "DirectPspRegistration",
    message: {
      txHash: input.txHash.toLowerCase() as Hash,
      rail: input.rail ?? "direct",
      token: input.token,
      // Lowercase so viem's strict checksum validation accepts any input
      // casing; EIP-712 hashes the address value, so casing never changes
      // the signature.
      recipient: input.recipient.toLowerCase() as Address,
      amount: input.amount,
      label: input.label,
      note: input.note ?? "",
      invoiceDate: input.invoiceDate ?? ""
    }
  } as const;
}
