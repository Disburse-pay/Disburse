import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TOKENS, arcTestnet, ARC_RPC_ENDPOINTS, erc20Abi } from "./lib/arc.js";
import { formatTokenAmount, parseTokenAmount, validateRecipient, type PaymentToken } from "./lib/payments.js";
import { buildBatchInvoiceFilename, generateBatchInvoicePdf, type BatchInvoiceItem } from "./lib/invoice.js";
import { send } from "./send.js";
import {
  authorizeExecution,
  type BatchPreview,
  type ConfirmationCallback
} from "./safety.js";

export type BatchOptions = {
  csvPath: string;
  privateKey: `0x${string}`;
  token?: PaymentToken;
  outDir?: string;
  rpc?: string;
  yes?: boolean;
  dryRun?: boolean;
  confirm?: ConfirmationCallback;
  trustedPspIssuer?: string;
  json?: boolean;
};

export type BatchRow = {
  row: number;
  to: string;
  amount: string;
  label: string;
  note?: string;
  token: PaymentToken;
};

export type BatchResult = {
  success: boolean;
  id: string;
  total: number;
  succeeded: number;
  failed: number;
  reconciliationRequired: number;
  batchJsonPath: string;
  batchPdfPath?: string;
  results: Array<{
    row: number;
    success: true;
    txHash: string;
    explorer: string;
    pspUid?: string;
    pspPath: string;
    pdfPath: string;
    amount: string;
    token: PaymentToken;
    recipient: string;
    label: string;
  } | {
    row: number;
    success: false;
    broadcast?: false;
    error: string;
  } | {
    row: number;
    success: false;
    broadcast: true;
    confirmed: boolean;
    txHash: string;
    explorer: string;
    recoveryPath: string;
    stage: string;
    error: string;
    retryGuidance: string;
  }>;
  totals: Partial<Record<PaymentToken, string>>;
  dryRun?: true;
  preview?: BatchPreview;
  error?: string;
};

export async function batch(opts: BatchOptions): Promise<BatchResult> {
  const rows = await readBatchCsv(opts.csvPath, opts.token || "USDC");
  if (!/^0x[0-9a-fA-F]{64}$/.test(opts.privateKey)) {
    throw new Error("privateKey must be 0x + 64 hex characters");
  }
  const account = privateKeyToAccount(opts.privateKey);
  const outDir = resolve(opts.outDir || process.cwd());
  const id = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const batchJsonPath = resolve(outDir, `disburse-batch-${id}.json`);

  await validateBatch(rows);
  await ensureBatchBalances(rows, account.address, opts.rpc);

  const previewTotals: Partial<Record<PaymentToken, string>> = {};
  for (const row of rows) {
    addTotal(previewTotals, row.token, row.amount);
  }
  const preview: BatchPreview = {
    kind: "batch",
    chainId: arcTestnet.id,
    payer: account.address,
    paymentCount: rows.length,
    totals: previewTotals,
    rows: rows.map((row) => ({
      row: row.row,
      recipient: validateRecipient(row.to),
      token: row.token,
      amount: formatTokenAmount(parseTokenAmount(row.amount, row.token), row.token),
      label: row.label.trim()
    }))
  };
  const authorization = await authorizeExecution(preview, opts);
  if (authorization === "dry-run") {
    log(opts, "Dry run complete. No batch transactions were broadcast.");
    return {
      success: true,
      dryRun: true,
      preview,
      id,
      total: rows.length,
      succeeded: 0,
      failed: 0,
      reconciliationRequired: 0,
      batchJsonPath,
      results: [],
      totals: previewTotals
    };
  }

  log(opts, `Starting batch ${id}: ${rows.length} payment(s)`);
  await access(outDir, constants.W_OK);

  const result: BatchResult = {
    success: true,
    id,
    total: rows.length,
    succeeded: 0,
    failed: 0,
    reconciliationRequired: 0,
    batchJsonPath,
    results: [],
    totals: {}
  };
  const invoiceItems: BatchInvoiceItem[] = [];
  await writeFile(batchJsonPath, JSON.stringify(result, null, 2), "utf8");

  for (const row of rows) {
    log(opts, `\n[${row.row}/${rows.length}] Sending ${row.amount} ${row.token} to ${row.to}`);
    try {
      const sent = await send({
        recipient: row.to,
        amount: row.amount,
        label: row.label,
        note: row.note,
        token: row.token,
        privateKey: opts.privateKey,
        outDir,
        rpc: opts.rpc,
        yes: true,
        trustedPspIssuer: opts.trustedPspIssuer,
        json: opts.json
      });
      if ("dryRun" in sent) {
        throw new Error("Unexpected dry-run result after batch confirmation.");
      }
      if (!sent.success) {
        result.success = false;
        result.reconciliationRequired += 1;
        result.error =
          `Batch stopped at row ${row.row}: transaction ${sent.txHash} was broadcast and requires reconciliation.`;
        result.results.push({
          row: row.row,
          success: false,
          broadcast: true,
          confirmed: sent.confirmed,
          txHash: sent.txHash,
          explorer: sent.explorer,
          recoveryPath: sent.recoveryPath,
          stage: sent.stage,
          error: sent.error,
          retryGuidance: sent.retryGuidance
        });
        await writeFile(batchJsonPath, JSON.stringify(result, null, 2), "utf8");
        log(opts, `\nBatch stopped at row ${row.row}: ${sent.retryGuidance}`);
        break;
      }

      result.succeeded += 1;
      addTotal(result.totals, row.token, sent.amount);
      result.results.push({
        row: row.row,
        success: true,
        txHash: sent.txHash,
        explorer: sent.explorer,
        pspUid: sent.pspUid,
        pspPath: sent.proofPath,
        pdfPath: sent.pdfPath,
        amount: sent.amount,
        token: sent.token,
        recipient: sent.recipient,
        label: sent.label
      });
      await writeFile(batchJsonPath, JSON.stringify(result, null, 2), "utf8");

      const psp = sent.psp as {
        invoice?: {
          requestId?: string;
          recipient?: string;
          payer?: string;
          invoiceDate?: string;
        };
        settlement?: {
          blockNumber?: string;
          settledAt?: string;
        };
        digest?: string;
      };
      const invoice = psp.invoice;
      const invoiceRecipient = invoice?.recipient
        ? validateRecipient(invoice.recipient)
        : sent.recipient;
      const invoicePayer = invoice?.payer
        ? validateRecipient(invoice.payer)
        : account.address;
      const settlementBlock = typeof psp.settlement?.blockNumber === "string"
        && /^(0|[1-9]\d*)$/.test(psp.settlement.blockNumber)
          ? psp.settlement.blockNumber
          : "0";
      const settledAt = typeof psp.settlement?.settledAt === "string"
        && Number.isFinite(Date.parse(psp.settlement.settledAt))
          ? psp.settlement.settledAt
          : new Date().toISOString();
      const pspDigest = typeof psp.digest === "string" && /^0x[0-9a-fA-F]{64}$/.test(psp.digest)
        ? psp.digest
        : undefined;
      invoiceItems.push({
        row: row.row,
        request: {
          id: invoice?.requestId || sent.requestId || `row-${row.row}`,
          recipient: invoiceRecipient,
          token: sent.token,
          amount: sent.amount,
          label: sent.label,
          note: sent.note,
          invoiceDate: invoice?.invoiceDate
        },
        receipt: {
          requestId: invoice?.requestId || sent.requestId || `row-${row.row}`,
          txHash: sent.txHash,
          from: invoicePayer,
          to: invoiceRecipient,
          token: sent.token,
          amount: sent.amount,
          blockNumber: settlementBlock,
          confirmedAt: settledAt,
          explorerUrl: sent.explorer
        },
        pspDigest,
        pspUid: sent.pspUid,
        pspVerifierUrl: "https://app.disburse.online",
        proofPath: sent.proofPath
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.success = false;
      result.failed += 1;
      result.error = `Batch stopped at row ${row.row}: ${message}`;
      result.results.push({ row: row.row, success: false, error: message });
      await writeFile(batchJsonPath, JSON.stringify(result, null, 2), "utf8");
      log(opts, `\nBatch stopped at row ${row.row}: ${message}`);
      break;
    }
  }

  const batchPdfPath = resolve(outDir, buildBatchInvoiceFilename(id));
  result.batchPdfPath = batchPdfPath;
  await writeFile(
    batchPdfPath,
    Buffer.from(await generateBatchInvoicePdf({
      id,
      createdAt: new Date().toISOString(),
      payer: account.address,
      items: invoiceItems,
      totals: result.totals,
      batchJsonPath,
      failed: result.results
        .filter((row) => !row.success)
        .map((row) => ({
          row: row.row,
          error: row.broadcast
            ? `${row.error} Transaction ${row.txHash} was broadcast; do not resend.`
            : row.error
        }))
    }))
  );
  await writeFile(batchJsonPath, JSON.stringify(result, null, 2), "utf8");

  log(opts, `\nBatch complete: ${result.succeeded}/${result.total} succeeded`);
  log(opts, `  Batch JSON: ${batchJsonPath}`);
  log(opts, `  Batch PDF:  ${batchPdfPath}`);

  return result;
}

export async function readBatchCsv(path: string, defaultToken: PaymentToken): Promise<BatchRow[]> {
  const text = await readFile(path, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV must include a header and at least one payment row.");

  const headers = parseCsvLine(lines[0]).map((value) => value.trim().toLowerCase());
  const required = ["to", "amount", "label"];
  for (const key of required) {
    if (!headers.includes(key)) throw new Error(`CSV missing required column: ${key}`);
  }

  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = values[i]?.trim() ?? "";
    });

    const token = (row.token || defaultToken).toUpperCase();
    if (token !== "USDC" && token !== "EURC") {
      throw new Error(`Row ${index + 2}: token must be USDC or EURC.`);
    }

    return {
      row: index + 2,
      to: row.to,
      amount: row.amount,
      label: row.label,
      note: row.note || undefined,
      token
    };
  });
}

async function validateBatch(rows: BatchRow[]) {
  for (const row of rows) {
    try {
      validateRecipient(row.to);
      parseTokenAmount(row.amount, row.token);
      if (!row.label.trim()) throw new Error("label is required.");
      if (row.label.trim().length > 80) throw new Error("label must be 80 characters or less.");
      if (row.note && row.note.trim().length > 240) throw new Error("note must be 240 characters or less.");
    } catch (error) {
      throw new Error(`Row ${row.row}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function ensureBatchBalances(rows: BatchRow[], payer: `0x${string}`, rpc?: string) {
  const client = createPublicClient({ chain: arcTestnet, transport: http(rpc || ARC_RPC_ENDPOINTS[0].url, { timeout: 15_000 }) });
  const needed: Partial<Record<PaymentToken, bigint>> = {};
  for (const row of rows) {
    needed[row.token] = (needed[row.token] ?? 0n) + parseTokenAmount(row.amount, row.token);
  }

  for (const token of Object.keys(needed) as PaymentToken[]) {
    const balance = await client.readContract({
      address: TOKENS[token].address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [payer]
    });
    if (balance < needed[token]!) {
      throw new Error(`Insufficient ${token} balance for batch. Have ${formatTokenAmount(balance, token)}, need ${formatTokenAmount(needed[token]!, token)}.`);
    }
  }
}

function addTotal(totals: Partial<Record<PaymentToken, string>>, token: PaymentToken, amount: string) {
  const current = totals[token] ? parseTokenAmount(totals[token]!, token) : 0n;
  totals[token] = formatTokenAmount(current + parseTokenAmount(amount, token), token);
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function log(opts: Pick<BatchOptions, "json">, message: string) {
  if (!opts.json) console.log(message);
}
