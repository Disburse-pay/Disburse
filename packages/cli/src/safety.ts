import type { Address } from "viem";
import type { PaymentToken } from "./lib/payments.js";

export type SendPreview = {
  kind: "send";
  chainId: number;
  payer: Address;
  recipient: Address;
  token: PaymentToken;
  tokenAddress: Address;
  amount: string;
  label: string;
  rpcUrl: string;
};

export type BatchPreview = {
  kind: "batch";
  chainId: number;
  payer: Address;
  paymentCount: number;
  totals: Partial<Record<PaymentToken, string>>;
  rows: Array<{
    row: number;
    recipient: Address;
    token: PaymentToken;
    amount: string;
    label: string;
  }>;
};

export type ExecutionPreview = SendPreview | BatchPreview;
export type ConfirmationCallback = (preview: ExecutionPreview) => Promise<boolean>;

export async function authorizeExecution(
  preview: ExecutionPreview,
  options: {
    yes?: boolean;
    dryRun?: boolean;
    confirm?: ConfirmationCallback;
  }
): Promise<"approved" | "dry-run"> {
  if (options.dryRun) {
    return "dry-run";
  }
  if (options.yes) {
    return "approved";
  }
  if (!options.confirm) {
    throw new Error("Interactive confirmation is required. Review with --dry-run or explicitly pass --yes.");
  }
  if (!(await options.confirm(preview))) {
    throw new Error("Disbursement cancelled before broadcast.");
  }
  return "approved";
}

export function formatExecutionPreview(preview: ExecutionPreview): string {
  if (preview.kind === "send") {
    return [
      "Review disbursement",
      `  Chain ID:  ${preview.chainId}`,
      `  From:      ${preview.payer}`,
      `  To:        ${preview.recipient}`,
      `  Token:     ${preview.amount} ${preview.token} (${preview.tokenAddress})`,
      `  Label:     ${preview.label}`,
      `  RPC:       ${preview.rpcUrl}`
    ].join("\n");
  }

  const totals = (Object.entries(preview.totals) as Array<[PaymentToken, string]>)
    .map(([token, amount]) => `${amount} ${token}`)
    .join(", ");
  return [
    "Review batch disbursement",
    `  Chain ID:  ${preview.chainId}`,
    `  From:      ${preview.payer}`,
    `  Payments:  ${preview.paymentCount}`,
    `  Totals:    ${totals || "0"}`,
    ...preview.rows.map(
      (row) => `  Row ${row.row}: ${row.amount} ${row.token} -> ${row.recipient} (${row.label})`
    )
  ].join("\n");
}
