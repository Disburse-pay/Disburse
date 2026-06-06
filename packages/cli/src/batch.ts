import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TOKENS, arcTestnet, ARC_RPC_ENDPOINTS, erc20Abi } from "./lib/arc.js";
import { formatTokenAmount, parseTokenAmount, validateRecipient, type PaymentToken } from "./lib/payments.js";
import { buildBatchInvoiceFilename, generateBatchInvoicePdf, type BatchInvoiceItem } from "./lib/invoice.js";
import { send, type SendResult } from "./send.js";

export type BatchOptions = {
  csvPath: string;
  privateKey: `0x${string}`;
  token?: PaymentToken;
  outDir?: string;
  rpc?: string;
  yes?: boolean;
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
    error: string;
  }>;
  totals: Partial<Record<PaymentToken, string>>;
  error?: string;
};

export async function batch(opts: BatchOptions): Promise<BatchResult> {
  const rows = await readBatchCsv(opts.csvPath, opts.token || "USDC");
  const account = privateKeyToAccount(opts.privateKey);
  const outDir = resolve(opts.outDir || process.cwd());
  const id = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const batchJsonPath = resolve(outDir, `disburse-batch-${id}.json`);

  await validateBatch(rows);
  await ensureBatchBalances(rows, account.address, opts.rpc);

  log(opts, `Starting batch ${id}: ${rows.length} payment(s)`);

  const result: BatchResult = {
    success: true,
    id,
    total: rows.length,
    succeeded: 0,
    failed: 0,
    batchJsonPath,
    results: [],
    totals: {}
  };
  const invoiceItems: BatchInvoiceItem[] = [];

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
        yes: opts.yes,
        json: opts.json
      });

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

      const psp = sent.psp as Record<string, any>;
      const invoice = psp.invoice as Record<string, any> | undefined;
      invoiceItems.push({
        row: row.row,
        request: {
          id: invoice?.requestId || sent.requestId || `row-${row.row}`,
          recipient: invoice?.recipient || sent.recipient,
          token: sent.token,
          amount: sent.amount,
          label: sent.label,
          note: sent.note,
          invoiceDate: invoice?.invoiceDate
        },
        receipt: {
          requestId: invoice?.requestId || sent.requestId || `row-${row.row}`,
          txHash: sent.txHash,
          from: invoice?.payer || account.address,
          to: invoice?.recipient || sent.recipient,
          token: sent.token,
          amount: sent.amount,
          blockNumber: psp.settlement?.blockNumber || "0",
          confirmedAt: psp.settlement?.settledAt || new Date().toISOString(),
          explorerUrl: sent.explorer
        },
        pspDigest: psp.digest,
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
      failed: result.results.filter((row): row is { row: number; success: false; error: string } => !row.success)
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
