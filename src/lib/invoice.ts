import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { ARC_CHAIN_ID } from "./arc";
import { shortAddress, type PaymentRequest, type Receipt } from "./payments";

export type InvoiceInput = {
  request: PaymentRequest;
  receipt: Receipt;
  pspDigest?: string;
  pspVerifierUrl?: string;
};

type InvoiceRow = {
  label: string;
  value: string;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 54;

export function buildInvoiceFilename({ request, receipt }: InvoiceInput): string {
  const label = request.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 44);
  return `disburse-invoice-${label || request.id}-${receipt.txHash.slice(2, 10)}.pdf`;
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
  const { request, receipt } = input;
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const mono = await document.embedFont(StandardFonts.Courier);

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
    formatInvoiceDate(request.invoiceDate)
  ]);
  document.setCreationDate(new Date(receipt.confirmedAt));
  document.setModificationDate(new Date(receipt.confirmedAt));

  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 170,
    width: PAGE_WIDTH,
    height: 170,
    color: rgb(0.93, 0.95, 0.93)
  });
  page.drawText("Disburse", {
    x: MARGIN,
    y: PAGE_HEIGHT - 76,
    size: 16,
    font: bold,
    color: rgb(0.13, 0.13, 0.11)
  });
  page.drawText("Payment Invoice", {
    x: MARGIN,
    y: PAGE_HEIGHT - 122,
    size: 34,
    font: bold,
    color: rgb(0.13, 0.13, 0.11)
  });
  page.drawText(`${request.amount} ${request.token}`, {
    x: PAGE_WIDTH - MARGIN - 170,
    y: PAGE_HEIGHT - 86,
    size: 22,
    font: bold,
    color: rgb(0.13, 0.13, 0.11)
  });
  page.drawText(shortAddress(receipt.txHash, 10, 8), {
    x: PAGE_WIDTH - MARGIN - 170,
    y: PAGE_HEIGHT - 112,
    size: 10,
    font: mono,
    color: rgb(0.34, 0.36, 0.32)
  });

  let y = PAGE_HEIGHT - 220;
  for (const row of buildInvoiceRows(input)) {
    page.drawText(row.label.toUpperCase(), {
      x: MARGIN,
      y,
      size: 8,
      font: bold,
      color: rgb(0.45, 0.44, 0.4)
    });

    y = drawWrappedText(page, row.value, {
      x: 170,
      y,
      maxWidth: PAGE_WIDTH - 170 - MARGIN,
      size: row.value.startsWith("0x") ? 9 : 10,
      lineHeight: 14,
      font: row.value.startsWith("0x") ? mono : regular,
      color: rgb(0.13, 0.13, 0.11)
    });
    y -= 18;
  }

  page.drawLine({
    start: { x: MARGIN, y: 86 },
    end: { x: PAGE_WIDTH - MARGIN, y: 86 },
    thickness: 1,
    color: rgb(0.83, 0.82, 0.78)
  });

  // PSP digest in footer when available
  if (input.pspDigest) {
    page.drawText(`PSP Digest: ${input.pspDigest}`, {
      x: MARGIN,
      y: 72,
      size: 7,
      font: mono,
      color: rgb(0.45, 0.44, 0.4)
    });
    page.drawText(`Verify: npx @disburse/psp-verify proof.json | ${input.pspVerifierUrl || "https://disburse.app"}/api/psp-viewer`, {
      x: MARGIN,
      y: 60,
      size: 6.5,
      font: regular,
      color: rgb(0.45, 0.44, 0.4)
    });
    page.drawText("Generated locally after on-chain verification. Disburse does not custody funds.", {
      x: MARGIN,
      y: 48,
      size: 8,
      font: regular,
      color: rgb(0.45, 0.44, 0.4)
    });
  } else {
    page.drawText("Generated locally after on-chain verification. Disburse does not custody funds.", {
      x: MARGIN,
      y: 62,
      size: 8,
      font: regular,
      color: rgb(0.45, 0.44, 0.4)
    });
  }

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
