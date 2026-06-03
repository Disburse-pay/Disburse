import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  numberToHex,
  type Address,
  type Hash
} from "viem";
import {
  buildCrossChainNonce,
  crossChainErc20Abi,
  getCrossChain,
  isRemotePaymentSourceChainId,
  qrPaymentInitiatedEvent,
  qrPaymentSourceAbi,
  requestIdToBytes32,
  type PaymentSourceChainId,
  type RemotePaymentSourceChainId
} from "./crosschain.js";
import { requireCrossChainBrowserRoute } from "./crosschainConfig.js";
import { getWalletChainId, type Balances, type EthereumProvider, type TransferEstimate } from "./onchain.js";
import { createExpiry, parseTokenAmount, type PaymentRequest } from "./payments.js";

const WALLET_APPROVAL_TIMEOUT_MS = 5 * 60_000;
const RECEIPT_WAIT_TIMEOUT_MS = 120_000;
const ALLOWANCE_WAIT_TIMEOUT_MS = 30_000;
const ALLOWANCE_POLL_INTERVAL_MS = 1_500;
const SOURCE_PAYMENT_GAS_FALLBACK = 150_000n;

export async function switchToCrossChain(provider: EthereumProvider, chainId: PaymentSourceChainId): Promise<void> {
  const config = getCrossChain(chainId);
  const hexChainId = `0x${chainId.toString(16)}`;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }]
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
          chainId: hexChainId,
          chainName: config.label,
          nativeCurrency: {
            name: "Ether",
            symbol: config.nativeSymbol,
            decimals: 18
          },
          rpcUrls: [config.rpcUrl],
          blockExplorerUrls: [config.explorerUrl]
        }
      ]
    });
  }
}

export async function readCrossChainBalances(
  account: Address,
  request: PaymentRequest,
  sourceChainId: RemotePaymentSourceChainId
): Promise<Balances> {
  const route = requireCrossChainBrowserRoute(sourceChainId);
  const client = createCrossChainPublicClient(sourceChainId);
  const [nativeBalance, tokenBalance, gasPrice] = await Promise.all([
    client.getBalance({ address: account }),
    readCrossChainContract<bigint>(client, {
      address: route.tokenAddress,
      abi: crossChainErc20Abi,
      functionName: "balanceOf",
      args: [account]
    }),
    client.getGasPrice()
  ]);

  return {
    nativeGas: formatUnits(nativeBalance, 18),
    tokenBalance: formatUnits(tokenBalance, 6),
    gasPrice: formatUnits(gasPrice, 18)
  };
}

export async function estimateCrossChainPayment(
  account: Address,
  request: PaymentRequest,
  sourceChainId: RemotePaymentSourceChainId
): Promise<TransferEstimate> {
  const route = requireCrossChainBrowserRoute(sourceChainId);
  const client = createCrossChainPublicClient(sourceChainId);
  const amount = parseTokenAmount(request.amount, request.token);
  const allowance = await readCrossChainContract<bigint>(client, {
    address: route.tokenAddress,
    abi: crossChainErc20Abi,
    functionName: "allowance",
    args: [account, route.sourceContract]
  });
  const needsApproval = allowance < amount;
  const gasPrice = await client.getGasPrice();
  const approvalGas = needsApproval
    ? await client.estimateContractGas({
        account,
        address: route.tokenAddress,
        abi: crossChainErc20Abi,
        functionName: "approve",
        args: [route.sourceContract, amount]
      })
    : 0n;
  const paymentGas = await estimateSourcePaymentGas(
    () =>
      client.estimateContractGas({
        account,
        address: route.sourceContract,
        abi: qrPaymentSourceAbi,
        functionName: "pay",
        args: buildCrossChainPayArgs(request, sourceChainId, route.tokenAddress)
      }),
    needsApproval
  );
  const totalGas = approvalGas + paymentGas;

  return {
    gas: totalGas,
    gasPrice,
    fee: formatUnits(totalGas * gasPrice, 18),
    nativeSymbol: getCrossChain(sourceChainId).nativeSymbol,
    approvalGas: needsApproval ? approvalGas : undefined,
    paymentGas,
    needsApproval
  };
}

export async function submitCrossChainPayment(
  provider: EthereumProvider,
  account: Address,
  request: PaymentRequest,
  sourceChainId: RemotePaymentSourceChainId,
  callbacks: {
    onApprovalRequested?: () => void;
    onApprovalSubmitted?: (hash: Hash) => void;
    onApprovalConfirmed?: () => void;
    onPaymentRequested?: () => void;
  } = {}
): Promise<Hash> {
  const walletChainId = await getWalletChainId(provider);
  if (walletChainId !== sourceChainId) {
    throw new Error(`Wallet is not on ${getCrossChain(sourceChainId).label}. Switch networks, then try again.`);
  }

  const route = requireCrossChainBrowserRoute(sourceChainId);
  const client = createCrossChainPublicClient(sourceChainId);
  const amount = parseTokenAmount(request.amount, request.token);
  const allowance = await readCrossChainContract<bigint>(client, {
    address: route.tokenAddress,
    abi: crossChainErc20Abi,
    functionName: "allowance",
    args: [account, route.sourceContract]
  });

  if (allowance < amount) {
    callbacks.onApprovalRequested?.();
    const approveHash = await requestWalletTransaction(provider, {
      from: account,
      to: route.tokenAddress,
      data: encodeFunctionData({
        abi: crossChainErc20Abi,
        functionName: "approve",
        args: [route.sourceContract, amount]
      }),
      value: "0x0"
    });
    callbacks.onApprovalSubmitted?.(approveHash);
    await waitForCrossChainReceipt(sourceChainId, approveHash);
    await waitForCrossChainAllowance(client, {
      account,
      amount,
      sourceChainId,
      spender: route.sourceContract,
      token: route.tokenAddress
    });
    callbacks.onApprovalConfirmed?.();
  }

  callbacks.onPaymentRequested?.();
  const paymentHash = await requestWalletTransaction(provider, {
    from: account,
    to: route.sourceContract,
    data: encodeFunctionData({
      abi: qrPaymentSourceAbi,
      functionName: "pay",
      args: buildCrossChainPayArgs(request, sourceChainId, route.tokenAddress)
    }),
    value: "0x0",
    nonce: numberToHex(await readPendingNonceOnChain(account, sourceChainId))
  });
  await waitForCrossChainPaymentReceipt(sourceChainId, paymentHash, request, route.sourceContract);
  return paymentHash;
}

export async function waitForCrossChainReceipt(sourceChainId: RemotePaymentSourceChainId, hash: Hash): Promise<void> {
  const receipt = await withTimeout(
    createCrossChainPublicClient(sourceChainId).waitForTransactionReceipt({
      hash,
      confirmations: 1
    }),
    RECEIPT_WAIT_TIMEOUT_MS,
    `Transaction ${hash} was submitted, but ${getCrossChain(sourceChainId).label} did not return a receipt yet. Use Verify in a minute.`
  );

  if (receipt.status !== "success") {
    throw new Error(`Transaction ${hash} reverted on ${getCrossChain(sourceChainId).label}.`);
  }
}

export async function waitForCrossChainPaymentReceipt(
  sourceChainId: RemotePaymentSourceChainId,
  hash: Hash,
  request: PaymentRequest,
  expectedSourceContract?: Address
): Promise<void> {
  const route = requireCrossChainBrowserRoute(sourceChainId);
  const sourceContract = expectedSourceContract ?? route.sourceContract;
  const receipt = await withTimeout(
    createCrossChainPublicClient(sourceChainId).waitForTransactionReceipt({
      hash,
      confirmations: 1
    }),
    RECEIPT_WAIT_TIMEOUT_MS,
    `Transaction ${hash} was submitted, but ${getCrossChain(sourceChainId).label} did not return a receipt yet. Use Verify in a minute.`
  );

  if (receipt.status !== "success") {
    throw new Error(`QR payment transaction ${hash} reverted on ${getCrossChain(sourceChainId).label}.`);
  }
  if (receipt.to?.toLowerCase() !== sourceContract.toLowerCase()) {
    throw new Error(
      `Wallet returned ${hash}, but it was sent to ${receipt.to ?? "an unknown contract"} instead of the QR payment contract ${sourceContract}. Confirm the QR pay transaction, not a USDC token transaction.`
    );
  }
  if (!receipt.logs.some((log) => isExpectedSourcePaymentLog(log as unknown as SourcePaymentLog, request, sourceContract, route.tokenAddress))) {
    throw new Error(
      `QR payment transaction ${hash} did not emit the expected payment event. The source-chain USDC may have moved without a Polymer-provable QR payment event.`
    );
  }
}

export function createCrossChainPublicClient(chainId: PaymentSourceChainId) {
  const config = getCrossChain(chainId);
  return createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl, {
      timeout: 10_000
    })
  });
}

function buildCrossChainPayArgs(
  request: PaymentRequest,
  sourceChainId: RemotePaymentSourceChainId,
  tokenAddress: Address
): readonly [ReturnType<typeof requestIdToBytes32>, Address, Address, bigint, bigint, bigint, bigint] {
  if (request.token !== "USDC") {
    throw new Error("Arc-settlement QR payments currently support USDC routes only.");
  }
  if (!request.destinationChainId) {
    throw new Error("Arc-settlement QR request is missing the Arc destination chain.");
  }
  if (!isRemotePaymentSourceChainId(sourceChainId)) {
    throw new Error("Source chain must be Base Sepolia or Monad Testnet for escrow payment.");
  }

  return [
    requestIdToBytes32(request.id),
    getAddress(request.recipient),
    tokenAddress,
    parseTokenAmount(request.amount, request.token),
    BigInt(request.destinationChainId),
    BigInt(Math.floor(Date.parse(request.expiresAt ?? createExpiry(request.createdAt)) / 1000)),
    buildCrossChainNonce(request.id, sourceChainId, request.destinationChainId)
  ];
}

type SourcePaymentLog = {
  address: Address;
  data: `0x${string}`;
  topics: [] | [`0x${string}`, ...`0x${string}`[]];
};

function isExpectedSourcePaymentLog(
  log: SourcePaymentLog,
  request: PaymentRequest,
  sourceContract: Address,
  tokenAddress: Address
): boolean {
  if (log.address.toLowerCase() !== sourceContract.toLowerCase()) {
    return false;
  }

  try {
    const decoded = decodeEventLog({
      abi: [qrPaymentInitiatedEvent],
      data: log.data,
      topics: log.topics
    }) as {
      eventName: string;
      args: {
        requestId: `0x${string}`;
        recipient: Address;
        token: Address;
        amount: bigint;
        destinationChainId: bigint;
      };
    };

    return (
      decoded.eventName === "QrPaymentInitiated" &&
      decoded.args.requestId.toLowerCase() === requestIdToBytes32(request.id).toLowerCase() &&
      decoded.args.recipient.toLowerCase() === request.recipient.toLowerCase() &&
      decoded.args.token.toLowerCase() === tokenAddress.toLowerCase() &&
      decoded.args.amount === parseTokenAmount(request.amount, request.token) &&
      decoded.args.destinationChainId === BigInt(request.destinationChainId ?? 0)
    );
  } catch {
    return false;
  }
}

async function readPendingNonceOnChain(account: Address, sourceChainId: RemotePaymentSourceChainId): Promise<number> {
  return createCrossChainPublicClient(sourceChainId).getTransactionCount({
    address: account,
    blockTag: "pending"
  });
}

async function estimateSourcePaymentGas(estimate: () => Promise<bigint>, needsApproval: boolean): Promise<bigint> {
  try {
    return await estimate();
  } catch (error) {
    if (!needsApproval || !isAllowanceRevert(error)) {
      throw error;
    }

    return SOURCE_PAYMENT_GAS_FALLBACK;
  }
}

async function waitForCrossChainAllowance(
  client: ReturnType<typeof createCrossChainPublicClient>,
  input: {
    account: Address;
    amount: bigint;
    sourceChainId: RemotePaymentSourceChainId;
    spender: Address;
    token: Address;
  }
): Promise<void> {
  const deadline = Date.now() + ALLOWANCE_WAIT_TIMEOUT_MS;
  let allowance = 0n;

  while (Date.now() <= deadline) {
    allowance = await readCrossChainContract<bigint>(client, {
      address: input.token,
      abi: crossChainErc20Abi,
      functionName: "allowance",
      args: [input.account, input.spender]
    });
    if (allowance >= input.amount) {
      return;
    }

    await sleep(ALLOWANCE_POLL_INTERVAL_MS);
  }

  throw new Error(
    `USDC approval was mined, but ${getCrossChain(input.sourceChainId).label} still reports allowance ${formatUnits(allowance, 6)} USDC for the QR payment contract. Approve spender ${input.spender}, then try again.`
  );
}

async function requestWalletTransaction(
  provider: EthereumProvider,
  transaction: {
    from: Address;
    to: Address;
    data: `0x${string}`;
    value: "0x0";
    nonce?: `0x${string}`;
  }
): Promise<Hash> {
  const hash = await withTimeout(
    provider.request({
      method: "eth_sendTransaction",
      params: [transaction]
    }),
    WALLET_APPROVAL_TIMEOUT_MS,
    "Wallet approval did not open or return a transaction hash. Reopen this request in your wallet browser, then try again."
  );

  if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
    throw new Error("Wallet did not return a valid transaction hash.");
  }

  return hash as Hash;
}

function readProviderErrorCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return Number((error as { code?: unknown }).code);
  }
  return undefined;
}

function isAllowanceRevert(error: unknown): boolean {
  return readErrorText(error).some((message) => /allowance|transfer amount exceeds allowance/i.test(message));
}

function readCrossChainContract<T>(
  client: ReturnType<typeof createCrossChainPublicClient>,
  parameters: unknown
): Promise<T> {
  return client.readContract(parameters as any) as Promise<T>;
}

function readErrorText(error: unknown, seen = new Set<unknown>()): string[] {
  if (typeof error === "string") {
    return [error];
  }
  if (typeof error !== "object" || error === null) {
    return [];
  }
  if (seen.has(error)) {
    return [];
  }
  seen.add(error);

  const source = error as {
    message?: unknown;
    shortMessage?: unknown;
    details?: unknown;
    metaMessages?: unknown;
    cause?: unknown;
  };
  const messages = [source.message, source.shortMessage, source.details].filter(
    (value): value is string => typeof value === "string"
  );

  if (Array.isArray(source.metaMessages)) {
    messages.push(...source.metaMessages.filter((value): value is string => typeof value === "string"));
  }

  return [...messages, ...readErrorText(source.cause, seen)];
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
