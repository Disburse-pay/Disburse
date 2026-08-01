import type { Address } from "viem";
import {
  buildDisburseRegistrationTypedData,
  type DisburseRegistrationInput
} from "./directRegistration";
import type { EthereumProvider } from "./onchain";
import type { PaymentRequest, Receipt } from "./payments";

type DirectRegistrationResponse = {
  request: PaymentRequest;
  receipt: Receipt;
  psp?: Record<string, unknown>;
};

export async function registerDirectPayment(
  provider: EthereumProvider,
  payer: Address,
  input: DisburseRegistrationInput
): Promise<DirectRegistrationResponse> {
  const typedData = buildDisburseRegistrationTypedData(input);
  const signature = await provider.request({
    method: "eth_signTypedData_v4",
    params: [
      payer,
      JSON.stringify({
        ...typedData,
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" }
          ],
          ...typedData.types
        }
      })
    ]
  });
  if (typeof signature !== "string" || !/^0x(?:[a-fA-F0-9]{2}){64,2048}$/.test(signature)) {
    throw new Error("Wallet did not return a valid payment registration signature.");
  }

  let response: Response;
  try {
    response = await fetch("/api/disburse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, signature })
    });
  } catch {
    throw new Error("The transfer is confirmed, but Disburse registration is unavailable. Do not resend; retry Verify.");
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("The transfer is confirmed, but Disburse registration returned an unexpected response. Do not resend; retry Verify.");
  }
  const payload = (await response.json()) as Partial<DirectRegistrationResponse> & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Payment registration failed: ${response.status}. Do not resend; retry Verify.`);
  }
  if (!payload.request || !payload.receipt) {
    throw new Error("The transfer is confirmed, but Disburse registration returned an invalid record. Do not resend; retry Verify.");
  }
  return payload as DirectRegistrationResponse;
}
