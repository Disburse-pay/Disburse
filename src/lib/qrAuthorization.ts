import { getAddress, type Address, type Hex } from "viem";
import { ARC_CHAIN_ID, TOKENS } from "./arc.js";
import { parseTokenAmount, type PaymentRequest } from "./payments.js";
import type { EthereumProvider } from "./onchain.js";

export const QR_PAYMENT_AUTHORIZATION_DOMAIN = {
  name: "Disburse QR Payment",
  version: "1"
} as const;

export function buildQrPaymentAuthorizationTypedData(request: PaymentRequest, payer: Address) {
  const startBlock = BigInt(request.startBlock);
  if (startBlock < 0n) {
    throw new Error("Payment request start block is invalid.");
  }

  const expiryValue = request.expiresAt ?? request.dueAt;
  const expiryMs = expiryValue ? Date.parse(expiryValue) : 0;
  if (expiryValue && !Number.isFinite(expiryMs)) {
    throw new Error("Payment request expiry time is invalid.");
  }

  const tokenAddress = TOKENS[request.token].address;
  return {
    domain: {
      ...QR_PAYMENT_AUTHORIZATION_DOMAIN,
      chainId: BigInt(ARC_CHAIN_ID),
      verifyingContract: tokenAddress
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      QrPaymentAuthorization: [
        { name: "requestId", type: "string" },
        { name: "payer", type: "address" },
        { name: "recipient", type: "address" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "startBlock", type: "uint256" },
        { name: "expiresAt", type: "uint256" }
      ]
    },
    primaryType: "QrPaymentAuthorization",
    message: {
      requestId: request.id,
      payer: getAddress(payer),
      recipient: getAddress(request.recipient),
      token: tokenAddress,
      amount: parseTokenAmount(request.amount, request.token),
      startBlock,
      expiresAt: expiryValue ? BigInt(Math.floor(expiryMs / 1_000)) : 0n
    }
  } as const;
}

export async function requestQrPaymentAuthorization(
  provider: EthereumProvider,
  payer: Address,
  request: PaymentRequest
): Promise<Hex> {
  const authorization = await provider.request({
    method: "eth_signTypedData_v4",
    params: [
      getAddress(payer),
      JSON.stringify(
        buildQrPaymentAuthorizationTypedData(request, payer),
        (_key, value) => typeof value === "bigint" ? value.toString() : value
      )
    ]
  });

  if (
    typeof authorization !== "string" ||
    !/^0x(?:[a-fA-F0-9]{2}){64,2048}$/.test(authorization)
  ) {
    throw new Error("Wallet did not return a valid QR payment authorization.");
  }

  return authorization as Hex;
}
