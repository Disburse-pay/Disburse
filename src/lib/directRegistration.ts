import type { Address, Hash } from "viem";
import { DISBURSE_TYPED_DOMAIN } from "./ids.js";
import type { PaymentToken } from "./payments.js";

export type DisburseRegistrationInput = {
  txHash: Hash;
  rail?: "direct" | "gateway";
  token: PaymentToken;
  recipient: Address;
  amount: string;
  label: string;
  note?: string;
  invoiceDate?: string;
};

export const DIRECT_REGISTRATION_TYPES = {
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
} as const;

/**
 * Authorize one immutable direct-payment registration. The transaction hash
 * makes replay idempotent, while label/note/date binding prevents a third
 * party from poisoning accounting metadata for a real transfer.
 */
export function buildDisburseRegistrationTypedData(input: DisburseRegistrationInput) {
  return {
    domain: DISBURSE_TYPED_DOMAIN,
    types: DIRECT_REGISTRATION_TYPES,
    primaryType: "DirectPspRegistration",
    message: {
      txHash: input.txHash.toLowerCase() as Hash,
      rail: input.rail ?? "direct",
      token: input.token,
      recipient: input.recipient.toLowerCase() as Address,
      amount: input.amount,
      label: input.label,
      note: input.note ?? "",
      invoiceDate: input.invoiceDate ?? ""
    }
  } as const;
}
