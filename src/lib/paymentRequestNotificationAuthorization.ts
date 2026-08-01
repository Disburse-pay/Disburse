import type { Address } from "viem";
import { DISBURSE_TYPED_DOMAIN } from "./ids.js";

/**
 * Short-lived authorization for creating a server-backed payment request.
 * `notify` is the normalized target handle or an empty string. The signed
 * fields cover every user-controlled field stored or displayed by the API.
 */
export const PAYMENT_REQUEST_AUTH_TTL_SECONDS = 5 * 60;

export const PAYMENT_REQUEST_AUTHORIZATION_TYPES = {
  DisbursePaymentRequestAuthorization: [
    { name: "wallet", type: "address" },
    { name: "notify", type: "string" },
    { name: "recipient", type: "address" },
    { name: "token", type: "string" },
    { name: "amount", type: "string" },
    { name: "label", type: "string" },
    { name: "note", type: "string" },
    { name: "invoiceDate", type: "string" },
    { name: "expiresAt", type: "uint256" }
  ]
} as const;

export type PaymentRequestCreationAuthorization = {
  wallet: Address;
  notify: string;
  recipient: Address;
  token: "USDC";
  amount: string;
  label: string;
  note?: string;
  invoiceDate: string;
  expiresAt: bigint;
};

export function buildPaymentRequestAuthorizationTypedData(input: PaymentRequestCreationAuthorization) {
  return {
    domain: DISBURSE_TYPED_DOMAIN,
    types: PAYMENT_REQUEST_AUTHORIZATION_TYPES,
    primaryType: "DisbursePaymentRequestAuthorization",
    message: {
      wallet: input.wallet,
      notify: input.notify,
      recipient: input.recipient,
      token: input.token,
      amount: input.amount,
      label: input.label,
      note: input.note ?? "",
      invoiceDate: input.invoiceDate,
      expiresAt: input.expiresAt
    }
  } as const;
}

/** @deprecated Prefer PaymentRequestCreationAuthorization. */
export type PaymentRequestNotificationAuthorization = PaymentRequestCreationAuthorization;
