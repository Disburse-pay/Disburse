import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { ARC_CHAIN_ID } from "./arc.js";
import { shortAddress, type Receipt } from "./payments.js";

export type InvoiceInput = {
  request: {
    id: string;
    recipient: string;
    token: string;
    amount: string;
    label: string;
    note?: string;
    invoiceDate?: string;
  };
  receipt: Receipt;
  pspDigest?: string;
  pspUid?: string;
  pspVerifierUrl?: string;
};

export type BatchInvoiceItem = InvoiceInput & {
  row: number;
  proofPath: string;
};

export type BatchInvoiceInput = {
  id: string;
  createdAt: string;
  payer: string;
  items: BatchInvoiceItem[];
  totals: Partial<Record<string, string>>;
  batchJsonPath: string;
  failed?: Array<{ row: number; error: string }>;
};

type InvoiceRow = {
  label: string;
  value: string;
};

type Fonts = {
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 54;
const TEXT = rgb(0.13, 0.13, 0.11);
const MUTED = rgb(0.46, 0.46, 0.42);
const LINE = rgb(0.84, 0.85, 0.81);
const PANEL = rgb(0.96, 0.97, 0.95);
const PANEL_DARK = rgb(0.91, 0.93, 0.9);

export function buildInvoiceFilename({ request }: InvoiceInput): string {
  const id = request.id.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  return `disburse-invoice-${id || "proof"}.pdf`;
}

export function buildBatchInvoiceFilename(id: string): string {
  return `disburse-batch-${id}.pdf`;
}

export function buildInvoiceRows({ request, receipt }: InvoiceInput): InvoiceRow[] {
  return [
    { label: "Request ID", value: request.id },
    { label: "Label", value: request.label },
    { label: "Note", value: request.note ?? "None" },
    { label: "Invoice Date", value: formatInvoiceDate(request.invoiceDate) },
    { label: "Amount", value: `${request.amount} ${request.token}` },
    { label: "Recipient", value: request.recipient },
    { label: "Payer", value: receipt.from },
    { label: "Transaction", value: receipt.txHash },
    { label: "Block", value: receipt.blockNumber },
    { label: "Confirmed", value: formatDateTime(receipt.confirmedAt) },
    { label: "Explorer", value: receipt.explorerUrl },
    { label: "Network", value: `Arc Testnet (${ARC_CHAIN_ID})` }
  ];
}

export async function generateInvoicePdf(input: InvoiceInput): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const fonts = await embedFonts(document);
  drawInvoicePage(document.addPage([PAGE_WIDTH, PAGE_HEIGHT]), input, fonts);
  setInvoiceMetadata(document, input);
  return document.save();
}

export async function generateBatchInvoicePdf(input: BatchInvoiceInput): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const fonts = await embedFonts(document);
  drawBatchSummaryPage(document.addPage([PAGE_WIDTH, PAGE_HEIGHT]), input, fonts);

  for (const item of input.items) {
    drawInvoicePage(document.addPage([PAGE_WIDTH, PAGE_HEIGHT]), item, fonts, `Batch row ${item.row}`);
  }

  document.setTitle(`Disburse batch ${input.id}`);
  document.setAuthor("Disburse");
  document.setSubject(`${input.items.length} payment batch on Arc Testnet`);
  document.setKeywords([
    "Disburse",
    "batch",
    "Arc Testnet",
    input.id,
    ...input.items.flatMap((item) => [item.receipt.txHash, item.pspUid ?? ""])
  ].filter(Boolean));
  document.setCreationDate(new Date(input.createdAt));
  document.setModificationDate(new Date(input.createdAt));

  return document.save();
}

export function formatInvoiceDate(value?: string): string {
  if (!value) {
    return "Not provided";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit"
  }).format(new Date(`${value}T00:00:00`));
}

async function embedFonts(document: PDFDocument): Promise<Fonts> {
  return {
    regular: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
    mono: await document.embedFont(StandardFonts.Courier)
  };
}

function setInvoiceMetadata(document: PDFDocument, input: InvoiceInput) {
  const { request, receipt } = input;
  document.setTitle(`Disburse invoice ${request.id}`);
  document.setAuthor("Disburse");
  document.setSubject(`${request.label} - ${request.amount} ${request.token}`);
  document.setKeywords([
    "Disburse",
    "Arc Testnet",
    request.token,
    request.id,
    receipt.txHash,
    request.label,
    formatInvoiceDate(request.invoiceDate),
    input.pspUid ?? ""
  ].filter(Boolean));
  document.setCreationDate(new Date(receipt.confirmedAt));
  document.setModificationDate(new Date(receipt.confirmedAt));
}

function drawInvoicePage(page: PDFPage, input: InvoiceInput, fonts: Fonts, eyebrow = "Portable settlement proof") {
  const { request, receipt } = input;
  drawHeader(page, fonts, eyebrow);
  drawAmountHero(page, request.amount, request.token, fonts);

  page.drawText(request.label, {
    x: MARGIN,
    y: 630,
    size: 20,
    font: fonts.bold,
    color: TEXT
  });
  drawWrappedText(page, request.note ?? "No note provided", {
    x: MARGIN,
    y: 610,
    maxWidth: PAGE_WIDTH - MARGIN * 2,
    size: 10,
    lineHeight: 14,
    font: fonts.regular,
    color: MUTED
  });
  page.drawText(`${formatInvoiceDate(request.invoiceDate)} · Arc Testnet`, {
    x: MARGIN,
    y: 578,
    size: 9,
    font: fonts.regular,
    color: MUTED
  });

  drawSection(page, "FROM / TO", 540, fonts);
  drawTwoColumn(page, "Payer", shortAddress(receipt.from, 10, 8), "Recipient", shortAddress(request.recipient, 10, 8), 514, fonts);
  drawSmallMono(page, receipt.from, MARGIN, 492, fonts, 235);
  drawSmallMono(page, request.recipient, 315, 492, fonts, 200);

  drawSection(page, "TRANSACTION", 442, fonts);
  drawLabelValue(page, "Transaction hash", receipt.txHash, 416, fonts, true);
  drawLabelValue(page, "Block", receipt.blockNumber, 376, fonts);
  drawLabelValue(page, "Confirmed", formatDateTime(receipt.confirmedAt), 350, fonts);
  drawLabelValue(page, "Explorer", receipt.explorerUrl, 324, fonts, true);

  drawSection(page, "VERIFICATION", 250, fonts);
  drawLabelValue(page, "PSP UID", input.pspUid ?? "Not provided", 224, fonts, true);
  drawLabelValue(page, "PSP digest", input.pspDigest ?? "Not provided", 184, fonts, true);
  drawLabelValue(page, "Request ID", request.id, 144, fonts, true);

  const verifyCommand = input.pspUid
    ? `curl -s "${input.pspVerifierUrl || "https://app.disburse.online"}/api/psp?uid=${input.pspUid}" | npx @disburse/psp-verify --stdin`
    : "npx @disburse/psp-verify disburse-psp-....json";
  drawWrappedText(page, `Verify: ${verifyCommand}`, {
    x: MARGIN,
    y: 104,
    maxWidth: PAGE_WIDTH - MARGIN * 2,
    size: 7.2,
    lineHeight: 10,
    font: fonts.mono,
    color: MUTED
  });

  drawFooter(page, fonts);
}

function drawBatchSummaryPage(page: PDFPage, input: BatchInvoiceInput, fonts: Fonts) {
  drawHeader(page, fonts, "Batch settlement proof");
  page.drawText("Batch Disbursement", {
    x: MARGIN,
    y: 685,
    size: 30,
    font: fonts.bold,
    color: TEXT
  });
  page.drawText(`Batch ${input.id} · ${formatDateTime(input.createdAt)} · Arc Testnet`, {
    x: MARGIN,
    y: 662,
    size: 10,
    font: fonts.regular,
    color: MUTED
  });

  const succeeded = input.items.length;
  const failed = input.failed?.length ?? 0;
  const totalRows = succeeded + failed;
  drawMetricBox(page, "Rows", String(totalRows), MARGIN, 604, fonts);
  drawMetricBox(page, "Succeeded", String(succeeded), 202, 604, fonts);
  drawMetricBox(page, "Failed", String(failed), 350, 604, fonts);

  drawSection(page, "TOTALS", 530, fonts);
  let y = 504;
  for (const [token, amount] of Object.entries(input.totals)) {
    page.drawText(`${amount} ${token}`, { x: MARGIN, y, size: 18, font: fonts.bold, color: TEXT });
    y -= 28;
  }
  if (Object.keys(input.totals).length === 0) {
    page.drawText("No successful transfers", { x: MARGIN, y, size: 11, font: fonts.regular, color: MUTED });
  }

  drawSection(page, "PAYER", 430, fonts);
  drawLabelValue(page, "Wallet", input.payer, 404, fonts, true);
  drawLabelValue(page, "Batch result", input.batchJsonPath, 364, fonts, true);

  drawSection(page, "PAYMENTS", 310, fonts);
  y = 286;
  for (const item of input.items.slice(0, 8)) {
    page.drawText(`#${item.row}`, { x: MARGIN, y, size: 9, font: fonts.bold, color: MUTED });
    page.drawText(`${item.request.amount} ${item.request.token}`, { x: 88, y, size: 10, font: fonts.bold, color: TEXT });
    page.drawText(item.request.label, { x: 170, y, size: 10, font: fonts.regular, color: TEXT });
    page.drawText(item.pspUid ?? "No PSP", { x: 370, y, size: 8.5, font: fonts.mono, color: MUTED });
    y -= 22;
  }
  if (input.items.length > 8) {
    page.drawText(`+ ${input.items.length - 8} more payment pages`, { x: MARGIN, y, size: 9, font: fonts.regular, color: MUTED });
  }

  if (input.failed?.length) {
    drawSection(page, "FAILED ROWS", 114, fonts);
    y = 90;
    for (const failure of input.failed.slice(0, 3)) {
      page.drawText(`#${failure.row}: ${failure.error}`, { x: MARGIN, y, size: 8.5, font: fonts.regular, color: MUTED });
      y -= 14;
    }
  }

  drawFooter(page, fonts);
}

function drawHeader(page: PDFPage, fonts: Fonts, eyebrow: string) {
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 120, width: PAGE_WIDTH, height: 120, color: PANEL });
  page.drawText("DISBURSE", { x: MARGIN, y: PAGE_HEIGHT - 56, size: 13, font: fonts.bold, color: TEXT });
  page.drawText(eyebrow.toUpperCase(), { x: MARGIN, y: PAGE_HEIGHT - 76, size: 8, font: fonts.bold, color: MUTED });
}

function drawAmountHero(page: PDFPage, amount: string, token: string, fonts: Fonts) {
  page.drawRectangle({ x: MARGIN, y: 666, width: PAGE_WIDTH - MARGIN * 2, height: 86, color: PANEL_DARK, borderColor: LINE, borderWidth: 1 });
  const value = `${amount} ${token}`;
  const width = fonts.bold.widthOfTextAtSize(value, 32);
  page.drawText(value, { x: (PAGE_WIDTH - width) / 2, y: 700, size: 32, font: fonts.bold, color: TEXT });
}

function drawMetricBox(page: PDFPage, label: string, value: string, x: number, y: number, fonts: Fonts) {
  page.drawRectangle({ x, y, width: 126, height: 58, color: PANEL_DARK, borderColor: LINE, borderWidth: 1 });
  page.drawText(label.toUpperCase(), { x: x + 14, y: y + 36, size: 7.5, font: fonts.bold, color: MUTED });
  page.drawText(value, { x: x + 14, y: y + 14, size: 18, font: fonts.bold, color: TEXT });
}

function drawSection(page: PDFPage, label: string, y: number, fonts: Fonts) {
  page.drawText(label, { x: MARGIN, y, size: 8.5, font: fonts.bold, color: MUTED });
  page.drawLine({ start: { x: MARGIN, y: y - 10 }, end: { x: PAGE_WIDTH - MARGIN, y: y - 10 }, thickness: 0.6, color: LINE });
}

function drawTwoColumn(page: PDFPage, leftLabel: string, leftValue: string, rightLabel: string, rightValue: string, y: number, fonts: Fonts) {
  page.drawText(leftLabel.toUpperCase(), { x: MARGIN, y, size: 8, font: fonts.bold, color: MUTED });
  page.drawText(rightLabel.toUpperCase(), { x: 315, y, size: 8, font: fonts.bold, color: MUTED });
  page.drawText(leftValue, { x: MARGIN, y: y - 22, size: 13, font: fonts.bold, color: TEXT });
  page.drawText(rightValue, { x: 315, y: y - 22, size: 13, font: fonts.bold, color: TEXT });
}

function drawLabelValue(page: PDFPage, label: string, value: string, y: number, fonts: Fonts, mono = false) {
  page.drawText(label.toUpperCase(), { x: MARGIN, y, size: 7.5, font: fonts.bold, color: MUTED });
  drawWrappedText(page, value, {
    x: 160,
    y,
    maxWidth: PAGE_WIDTH - 160 - MARGIN,
    size: mono ? 8.2 : 9.5,
    lineHeight: mono ? 11 : 13,
    font: mono ? fonts.mono : fonts.regular,
    color: TEXT
  });
}

function drawSmallMono(page: PDFPage, value: string, x: number, y: number, fonts: Fonts, maxWidth: number) {
  drawWrappedText(page, value, { x, y, maxWidth, size: 7.4, lineHeight: 9, font: fonts.mono, color: MUTED });
}

function drawFooter(page: PDFPage, fonts: Fonts) {
  page.drawLine({ start: { x: MARGIN, y: 38 }, end: { x: PAGE_WIDTH - MARGIN, y: 38 }, thickness: 0.6, color: LINE });
  page.drawText("Disburse does not custody funds. Generated after on-chain verification.", {
    x: MARGIN,
    y: 22,
    size: 8,
    font: fonts.regular,
    color: MUTED
  });
}

function drawWrappedText(
  page: PDFPage,
  value: string,
  options: {
    x: number;
    y: number;
    maxWidth: number;
    size: number;
    lineHeight: number;
    font: PDFFont;
    color: RGB;
  }
): number {
  let y = options.y;
  for (const line of wrapText(value, options.font, options.size, options.maxWidth)) {
    page.drawText(line, {
      x: options.x,
      y,
      size: options.size,
      font: options.font,
      color: options.color
    });
    y -= options.lineHeight;
  }
  return y + options.lineHeight;
}

function wrapText(value: string, font: PDFFont, size: number, maxWidth: number) {
  const segments = value.split(/(\s+)/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const segment of segments) {
    const next = `${current}${segment}`;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
      continue;
    }

    if (current.trim()) {
      lines.push(current.trim());
      current = "";
    }

    if (font.widthOfTextAtSize(segment, size) <= maxWidth) {
      current = segment.trimStart();
      continue;
    }

    lines.push(...breakLongSegment(segment, font, size, maxWidth));
  }

  if (current.trim()) {
    lines.push(current.trim());
  }

  return lines.length ? lines : ["None"];
}

function breakLongSegment(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";

  for (const char of value) {
    const next = `${current}${char}`;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    current = char;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}
