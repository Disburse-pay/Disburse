import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  numberToHex,
  parseUnits,
  type Address,
  type EIP1193Provider,
  type Hash
} from "viem";
import {
  ARC_CHAIN_ID,
  ARC_EXPLORER_URL,
  ARC_MIN_GAS_PRICE,
  ARC_RPC_ENDPOINTS,
  ARC_RPC_URL,
  TOKENS,
  arcTestnet,
  erc20Abi,
  publicClient,
  transferEvent,
  type ArcRpcEndpoint
} from "./arc.js";
import {
  decodeTransferLog,
  makeReceipt,
  parseTokenAmount,
  transferMatchesRequest,
  type DecodedTransfer,
  type PaymentRequest,
  type PaymentToken,
  type Receipt
} from "./payments.js";

export type EthereumProvider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

export type Balances = {
  nativeGas: string;
  tokenBalance: string;
  gasPrice: string;
};

export type TransferEstimate = {
  gas: bigint;
  gasPrice: bigint;
  fee: string;
  nativeSymbol?: string;
  approvalGas?: bigint;
  paymentGas?: bigint;
  needsApproval?: boolean;
};

export type TokenTransfer = {
  recipient: Address;
  token: PaymentToken;
  amount: string;
};

export type SpendableTransfer = Pick<TokenTransfer, "token" | "amount">;

export type SpendabilityCheck = {
  availableNative: bigint;
  requiredNative: bigint;
  gasFee: bigint;
  availableToken: bigint;
  requiredToken: bigint;
  hasEnoughNative: boolean;
  hasEnoughToken: boolean;
};

export type RpcEndpointStatus = {
  id: ArcRpcEndpoint["id"];
  label: string;
  url: string;
  host: string;
  healthy: boolean;
  chainId?: number;
  blockNumber?: string;
  gasPrice?: string;
  safeGasPrice?: string;
  latencyMs?: number;
  error?: string;
};

export type RpcHealth = {
  healthy: boolean;
  checkedAt: string;
  activeEndpoint?: RpcEndpointStatus;
  endpoints: RpcEndpointStatus[];
  chainId?: number;
  blockNumber?: string;
  gasPrice?: string;
  safeGasPrice?: string;
  usdcDecimals?: number;
  eurcDecimals?: number;
};

export type VerificationResult =
  | { status: "paid"; receipt: Receipt; message: string }
  | { status: "possible_match"; transfer: DecodedTransfer; message: string }
  | { status: "open"; message: string };

export const ARC_LOG_WINDOW_BLOCKS = 10_000n;

export type BlockRange = {
  fromBlock: bigint;
  toBlock: bigint;
};

export type WalletTransferTransaction = {
  from: Address;
  to: Address;
  data: `0x${string}`;
  value: "0x0";
  nonce?: `0x${string}`;
};

export const WALLET_APPROVAL_TIMEOUT_MS = 5 * 60_000;
export const RECEIPT_WAIT_TIMEOUT_MS = 120_000;
export const ARC_NATIVE_USDC_DECIMALS = 18;
export const USDC_NATIVE_UNIT_SCALE = 10n ** BigInt(ARC_NATIVE_USDC_DECIMALS - TOKENS.USDC.decimals);

export function getInjectedProvider(): EthereumProvider | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return (window as Window & { ethereum?: EthereumProvider }).ethereum;
}

export async function connectWallet(provider: EthereumProvider): Promise<Address> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" } as any)) as string[];
  if (!accounts?.[0]) {
    throw new Error("Wallet did not return an account.");
  }
  return getAddress(accounts[0]);
}

export async function getWalletChainId(provider: EthereumProvider): Promise<number> {
  const chainId = (await provider.request({ method: "eth_chainId" } as any)) as string;
  return Number.parseInt(chainId, 16);
}

export async function switchToArc(provider: EthereumProvider): Promise<void> {
  const chainId = `0x${ARC_CHAIN_ID.toString(16)}`;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }]
    });
  } catch (error) {
    const code = readProviderErrorCode(error);
    if (code !== 4902) {
      throw error;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: "Arc Testnet",
          nativeCurrency: {
            name: "USDC",
            symbol: "USDC",
            decimals: 18
          },
          rpcUrls: [ARC_RPC_URL],
          blockExplorerUrls: [ARC_EXPLORER_URL]
        }
      ]
    });
  }
}

export async function readBalances(account: Address, transfer: TokenTransfer): Promise<Balances> {
  const [nativeBalance, tokenBalance, gasPrice] = await Promise.all([
    publicClient.getBalance({ address: account }),
    publicClient.readContract({
      address: TOKENS[transfer.token].address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account]
    }),
    publicClient.getGasPrice()
  ]);

  return {
    nativeGas: formatUnits(nativeBalance, 18),
    tokenBalance: formatUnits(tokenBalance, TOKENS[transfer.token].decimals),
    gasPrice: formatUnits(applyArcGasFloor(gasPrice), 18)
  };
}

export async function estimatePayment(account: Address, transfer: TokenTransfer): Promise<TransferEstimate> {
  const amount = parseTokenAmount(transfer.amount, transfer.token);
  const gasPrice = await currentSafeGasPrice();
  const gas = await publicClient.estimateContractGas({
    account,
    address: TOKENS[transfer.token].address,
    abi: erc20Abi,
    functionName: "transfer",
    args: [transfer.recipient, amount],
    gasPrice
  });

  return {
    gas,
    gasPrice,
    fee: formatUnits(gas * gasPrice, 18)
  };
}

export async function sendTokenTransfer(
  provider: EthereumProvider,
  account: Address,
  transferRequest: TokenTransfer
): Promise<Hash> {
  const hash = await submitTokenTransfer(provider, account, transferRequest);
  await waitForTransactionConfirmation(hash);

  return hash;
}

export async function submitTokenTransfer(
  provider: EthereumProvider,
  account: Address,
  transferRequest: TokenTransfer
): Promise<Hash> {
  const nonce = await readPendingNonce(account);
  return requestWalletTransaction(provider, buildErc20TransferTransaction(account, transferRequest, nonce));
}

export async function sendPayment(
  provider: EthereumProvider,
  account: Address,
  request: PaymentRequest
): Promise<Hash> {
  return sendTokenTransfer(provider, account, request);
}

export async function submitPayment(
  provider: EthereumProvider,
  account: Address,
  request: PaymentRequest
): Promise<Hash> {
  return submitTokenTransfer(provider, account, request);
}

export function buildErc20TransferTransaction(
  account: Address,
  transferRequest: TokenTransfer,
  nonce?: number
): WalletTransferTransaction {
  const amount = parseTokenAmount(transferRequest.amount, transferRequest.token);
  return {
    from: account,
    to: TOKENS[transferRequest.token].address,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [transferRequest.recipient, amount]
    }),
    value: "0x0",
    ...(nonce === undefined ? {} : { nonce: numberToHex(nonce) })
  };
}

export async function readPendingNonce(account: Address): Promise<number> {
  return publicClient.getTransactionCount({
    address: account,
    blockTag: "pending"
  });
}

export function getSpendabilityCheck(
  balances: Balances,
  transfer: SpendableTransfer,
  estimate?: TransferEstimate
): SpendabilityCheck {
  const availableNative = parseUnits(balances.nativeGas, ARC_NATIVE_USDC_DECIMALS);
  const gasFee = estimate ? estimate.gas * estimate.gasPrice : 0n;
  const nativeAmount = transfer.token === "USDC" ? usdcTokenAmountToNativeUnits(transfer.amount) : 0n;
  const requiredNative = nativeAmount + gasFee;
  const availableToken = parseTokenAmount(balances.tokenBalance, transfer.token);
  const requiredToken = parseTokenAmount(transfer.amount, transfer.token);

  return {
    availableNative,
    requiredNative,
    gasFee,
    availableToken,
    requiredToken,
    hasEnoughNative: availableNative > 0n && availableNative >= requiredNative,
    hasEnoughToken: availableToken >= requiredToken
  };
}

export function hasInsufficientNativeSpendBalance(
  balances: Balances | undefined,
  transfer: SpendableTransfer | undefined,
  estimate?: TransferEstimate
): boolean {
  if (!balances || !transfer?.amount || !transfer.token) {
    return false;
  }

  try {
    return !getSpendabilityCheck(balances, transfer, estimate).hasEnoughNative;
  } catch {
    return false;
  }
}

function usdcTokenAmountToNativeUnits(amount: string): bigint {
  return parseTokenAmount(amount, "USDC") * USDC_NATIVE_UNIT_SCALE;
}

async function requestWalletTransaction(
  provider: EthereumProvider,
  transaction: WalletTransferTransaction
): Promise<Hash> {
  const chainId = await getWalletChainId(provider);
  if (chainId !== ARC_CHAIN_ID) {
    throw new Error("Wallet is not on Arc Testnet. Switch networks, then try again.");
  }

  const hash = await withTimeout(
    provider.request({
      method: "eth_sendTransaction",
      params: [transaction]
    }),
    WALLET_APPROVAL_TIMEOUT_MS,
    "Wallet approval did not open or return a transaction hash. Reopen this request in your wallet browser, then try Pay request again."
  );

  if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
    throw new Error("Wallet did not return a valid transaction hash.");
  }

  return hash as Hash;
}

export async function waitForTransactionConfirmation(hash: Hash): Promise<void> {
  await withTimeout(
    publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1
    }),
    RECEIPT_WAIT_TIMEOUT_MS,
    `Transaction ${hash} was submitted, but Arc Testnet did not return a receipt yet. Use Verify in a minute.`
  );
}

export async function verifyPayment(request: PaymentRequest): Promise<VerificationResult> {
  if (request.txHash) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: request.txHash });
      const transfer = receipt.logs
        .filter((log) => log.address.toLowerCase() === TOKENS[request.token].address.toLowerCase())
        .map(decodeTransferLog)
        .find(
          (decoded): decoded is DecodedTransfer => Boolean(decoded && transferMatchesRequest(request, decoded))
        );

      if (transfer) {
        return {
          status: "paid",
          receipt: makeReceipt(request, transfer),
          message: "Receipt verified from transaction logs."
        };
      }
    } catch {
      return {
        status: "open",
        message: "Transaction hash is not available on Arcscan yet."
      };
    }
  }

  const latestBlock = await publicClient.getBlockNumber();
  const ranges = buildLogBlockRanges(BigInt(request.startBlock), latestBlock);
  const logs = [];

  for (const range of ranges) {
    const batch = await publicClient.getLogs({
      address: TOKENS[request.token].address,
      event: transferEvent,
      args: {
        to: request.recipient
      },
      fromBlock: range.fromBlock,
      toBlock: range.toBlock
    });
    logs.push(...batch);
  }

  const transfers = logs
    .map((log) => ({
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      from: getAddress(log.args.from ?? "0x0000000000000000000000000000000000000000"),
      to: getAddress(log.args.to ?? request.recipient),
      value: log.args.value ?? 0n
    }))
    .filter((transfer): transfer is DecodedTransfer => Boolean(transfer.txHash && transfer.blockNumber));

  return resolveTransferVerification(request, transfers);
}

export function buildLogBlockRanges(
  fromBlock: bigint,
  toBlock: bigint,
  windowSize = ARC_LOG_WINDOW_BLOCKS
): BlockRange[] {
  if (windowSize <= 0n) {
    throw new Error("Log scan window must be greater than zero.");
  }

  if (fromBlock > toBlock) {
    return [];
  }

  const ranges: BlockRange[] = [];
  let cursor = fromBlock;

  while (cursor <= toBlock) {
    const end = cursor + windowSize - 1n;
    ranges.push({
      fromBlock: cursor,
      toBlock: end > toBlock ? toBlock : end
    });
    cursor += windowSize;
  }

  return ranges;
}

export function resolveTransferVerification(
  request: PaymentRequest,
  transfers: DecodedTransfer[]
): VerificationResult {
  const sortedTransfers = [...transfers].sort((left, right) => {
    if (left.blockNumber === right.blockNumber) {
      return 0;
    }
    return left.blockNumber < right.blockNumber ? -1 : 1;
  });
  const recipientTransfers = sortedTransfers.filter(
    (transfer) => transfer.to.toLowerCase() === request.recipient.toLowerCase()
  );

  const exact = recipientTransfers.find((transfer) => transferMatchesRequest(request, transfer));
  if (exact) {
    return {
      status: "paid",
      receipt: makeReceipt(request, exact),
      message: "Exact transfer found on Arc Testnet."
    };
  }

  const possible = recipientTransfers.at(-1);
  if (possible) {
    return {
      status: "possible_match",
      transfer: possible,
      message: "A transfer to this recipient exists, but the amount differs."
    };
  }

  return {
    status: "open",
    message: "No matching transfer found from the request start block."
  };
}

export async function checkArcRpc(): Promise<RpcHealth> {
  const endpoints = await Promise.all(ARC_RPC_ENDPOINTS.map(probeArcRpcEndpoint));
  const activeEndpoint = selectActiveRpcEndpoint(endpoints);
  const checkedAt = new Date().toISOString();

  if (!activeEndpoint) {
    return {
      healthy: false,
      checkedAt,
      endpoints
    };
  }

  const activeClient = createEndpointPublicClient(activeEndpoint.url);
  const [usdcDecimals, eurcDecimals] = await Promise.all([
    activeClient.readContract({
      address: TOKENS.USDC.address,
      abi: erc20Abi,
      functionName: "decimals"
    }),
    activeClient.readContract({
      address: TOKENS.EURC.address,
      abi: erc20Abi,
      functionName: "decimals"
    })
  ]);

  return {
    healthy: true,
    checkedAt,
    activeEndpoint,
    endpoints,
    chainId: activeEndpoint.chainId,
    blockNumber: activeEndpoint.blockNumber,
    gasPrice: activeEndpoint.gasPrice,
    safeGasPrice: activeEndpoint.safeGasPrice,
    usdcDecimals,
    eurcDecimals
  };
}

export function applyArcGasFloor(gasPrice: bigint): bigint {
  return gasPrice > ARC_MIN_GAS_PRICE ? gasPrice : ARC_MIN_GAS_PRICE;
}

export function selectActiveRpcEndpoint(statuses: RpcEndpointStatus[]): RpcEndpointStatus | undefined {
  return statuses
    .filter((status) => status.healthy)
    .sort((left, right) => {
      const leftBlock = BigInt(left.blockNumber ?? 0);
      const rightBlock = BigInt(right.blockNumber ?? 0);
      if (leftBlock !== rightBlock) {
        return leftBlock > rightBlock ? -1 : 1;
      }

      return (left.latencyMs ?? Number.MAX_SAFE_INTEGER) - (right.latencyMs ?? Number.MAX_SAFE_INTEGER);
    })[0];
}

async function currentSafeGasPrice(): Promise<bigint> {
  const gasPrice = await publicClient.getGasPrice();
  return applyArcGasFloor(gasPrice);
}

async function probeArcRpcEndpoint(endpoint: ArcRpcEndpoint): Promise<RpcEndpointStatus> {
  const startedAt = Date.now();
  const host = new URL(endpoint.url).host;
  const client = createEndpointPublicClient(endpoint.url);

  try {
    const [chainId, blockNumber, gasPrice] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
      client.getGasPrice()
    ]);
    const healthy = chainId === ARC_CHAIN_ID;

    return {
      id: endpoint.id,
      label: endpoint.label,
      url: endpoint.url,
      host,
      healthy,
      chainId,
      blockNumber: blockNumber.toString(),
      gasPrice: formatUnits(gasPrice, 18),
      safeGasPrice: formatUnits(applyArcGasFloor(gasPrice), 18),
      latencyMs: Date.now() - startedAt,
      error: healthy ? undefined : `Unexpected chain ID ${chainId}.`
    };
  } catch (error) {
    return {
      id: endpoint.id,
      label: endpoint.label,
      url: endpoint.url,
      host,
      healthy: false,
      latencyMs: Date.now() - startedAt,
      error: errorToStatusMessage(error)
    };
  }
}

function createEndpointPublicClient(url: string) {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(url, {
      timeout: 8_000
    })
  });
}

function errorToStatusMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "shortMessage" in error) {
    const shortMessage = (error as { shortMessage?: unknown }).shortMessage;
    if (typeof shortMessage === "string" && shortMessage.trim()) {
      return shortMessage;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Endpoint did not respond.";
}

function readProviderErrorCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return Number((error as { code?: unknown }).code);
  }
  return undefined;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
