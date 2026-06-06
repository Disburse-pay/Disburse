import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createWalletClient,
  http,
  type Address,
  type Hash
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ARC_EXPLORER_URL,
  ARC_RPC_ENDPOINTS,
  TOKENS,
  arcTestnet,
  createArcPublicClient,
  erc20Abi
} from "./lib/arc.js";
import {
  formatTokenAmount,
  makeReceipt,
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

export type SendOptions = {
  recipient: string;
  amount: string;
  label: string;
  note?: string;
  token?: PaymentToken;
  privateKey: `0x${string}`;
  outDir?: string;
  rpc?: string;
  yes?: boolean;
};

export type SendResult = {
  txHash: Hash;
  psp: unknown;
  proofPath: string;
  pdfPath: string;
  explorer: string;
};

const DEFAULT_API_BASE = "https://app.disburse.online";

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

  const hash = await wallet.writeContract({
    address: tokenAddr,
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, amountUnits],
    gas: 80_000n // safe over-estimate for simple ERC-20 on Arc
  });

  const explorer = `${ARC_EXPLORER_URL}/tx/${hash}`;

  console.log(`Transaction submitted: ${hash}`);
  console.log(`Explorer: ${explorer}`);
  console.log("Waiting for confirmation (1 block)...");

  const receipt = await pub.waitForTransactionReceipt({ hash, confirmations: 1 });
  const blockNumber = receipt.blockNumber.toString();

  console.log(`Confirmed in block ${blockNumber}`);

  // Build local receipt for PDF (the server will also verify)
  const localReceipt: Receipt = makeReceipt(
    { id: `direct-${hash}`, token },
    {
      txHash: hash,
      blockNumber: receipt.blockNumber,
      from: payer,
      to: recipient,
      value: amountUnits
    }
  );

  // Register with Disburse to obtain signed PSP (the source of truth for proofs)
  const apiBase = getApiBase();
  const registerBody = {
    txHash: hash,
    label,
    note,
    token,
    recipient: recipient,
    amount,
    signature: await account.signMessage({
      message: buildDisburseAuthorizationMessage({
        txHash: hash,
        token,
        recipient,
        amount,
        label,
        note
      })
    })
  };

  const regRes = await fetch(`${apiBase}/api/disburse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(registerBody)
  });

  if (!regRes.ok) {
    const text = await regRes.text().catch(() => "");
    throw new Error(`Failed to register disbursement for PSP: ${regRes.status} ${text}`);
  }

  const regJson = (await regRes.json()) as { psp?: unknown; error?: string };
  if (!regJson.psp) {
    throw new Error(`Server did not return a PSP: ${JSON.stringify(regJson)}`);
  }
  const psp = regJson.psp;

  const outDir = resolve(opts.outDir || process.cwd());

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
    },
    receipt: localReceipt,
    pspDigest,
    pspUid,
    pspVerifierUrl: apiBase
  };

  const pdfBytes = await generateInvoicePdf(invoiceInput);
  const pdfPath = resolve(outDir, buildInvoiceFilename(invoiceInput));
  await writeFile(pdfPath, Buffer.from(pdfBytes));

  // Success output for agents / humans
  console.log("\n✓ Disbursement complete");
  console.log(`  Tx:        ${hash}`);
  console.log(`  Explorer:  ${explorer}`);
  console.log(`  Proof:     ${proofPath}`);
  console.log(`  Invoice:   ${pdfPath}`);

  if (pspDigest) {
    const uid = pspUid || `psp:${pspDigest.slice(2, 18)}`;
    console.log(`  PSP UID:   ${uid}`);
    console.log("\nVerify independently:");
    console.log(`  npx @disburse/psp-verify ${proofPath}`);
    console.log(`  curl -s "${apiBase}/api/psp?uid=${uid}" | npx @disburse/psp-verify --stdin`);
  }

  console.log("\nDisburse does not custody funds. Proofs are independently verifiable.");

  return {
    txHash: hash,
    psp,
    proofPath,
    pdfPath,
    explorer
  };
}

function buildDisburseAuthorizationMessage(input: {
  txHash: Hash;
  token: PaymentToken;
  recipient: Address;
  amount: string;
  label: string;
  note?: string;
}): string {
  return [
    "Disburse direct PSP registration",
    `txHash: ${input.txHash.toLowerCase()}`,
    `token: ${input.token}`,
    `recipient: ${input.recipient.toLowerCase()}`,
    `amount: ${input.amount}`,
    `label: ${input.label}`,
    `note: ${input.note ?? ""}`
  ].join("\n");
}
