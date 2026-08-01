import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  pad,
  parseAbiItem,
  parseAbiParameters,
  stringToHex,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ARC_CHAIN_ID, TOKENS } from "../../src/lib/arc.js";
import {
  ARC_GATEWAY_DOMAIN,
  GATEWAY_MINTER_ADDRESS
} from "../../src/lib/gateway/types.js";
import {
  BASE_SEPOLIA_CHAIN_ID,
  requestIdToBytes32,
} from "../../src/lib/crosschain.js";
import type { PaymentRequest, Receipt } from "../../src/lib/payments.js";
import {
  readCrossChainSettlementLog,
  readDirectSettlementLog,
  readSourcePaymentLog,
  type SourcePaymentEvidence,
} from "./fetchLogs.js";

const mocks = vi.hoisted(() => ({
  getArcReceipt: vi.fn(),
  getArcBlock: vi.fn(),
  getSourceReceipt: vi.fn(),
  getSourceBlock: vi.fn(),
}));

vi.mock("../../src/lib/arc.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/arc.js")>();
  return {
    ...actual,
    publicClient: {
      getTransactionReceipt: mocks.getArcReceipt,
      getBlock: mocks.getArcBlock,
    },
  };
});

vi.mock("../../src/lib/crosschain.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/crosschain.js")>();
  return {
    ...actual,
    createCrossChainPublicClient: () => ({
      getTransactionReceipt: mocks.getSourceReceipt,
      getBlock: mocks.getSourceBlock,
    }),
  };
});

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from,address indexed to,uint256 value)"
);
const GATEWAY_ATTESTATION_USED_EVENT = parseAbiItem(
  "event AttestationUsed(address indexed token,address indexed recipient,bytes32 indexed transferSpecHash,uint32 sourceDomain,bytes32 sourceDepositor,bytes32 sourceSigner,uint256 value)"
);
const INITIATED_EVENT = parseAbiItem(
  "event QrPaymentInitiated(bytes32 indexed requestId,address indexed payer,address indexed recipient,address token,uint256 amount,uint256 destinationChainId,uint256 nonce)"
);
const SETTLED_EVENT = parseAbiItem(
  "event QrPaymentSettled(bytes32 indexed settlementId,bytes32 indexed requestId,address indexed recipient,uint32 sourceChainId,address payer,address sourceToken,address destinationToken,uint256 amount,uint256 nonce)"
);

const REQUEST_ID = "7e7b5b2f-9df1-4ea1-a0da-0889fb6bd4fd";
const ARC_TX = `0x${"a".repeat(64)}` as Hash;
const ARC_BLOCK_HASH = `0x${"b".repeat(64)}` as Hash;
const SOURCE_TX = `0x${"c".repeat(64)}` as Hash;
const SOURCE_BLOCK_HASH = `0x${"d".repeat(64)}` as Hash;
const OTHER_TX = `0x${"e".repeat(64)}` as Hash;
const OTHER_BLOCK_HASH = `0x${"f".repeat(64)}` as Hash;
const SETTLEMENT_ID = keccak256(stringToHex("settlement")) as Hex;
const OTHER_SETTLEMENT_ID = keccak256(stringToHex("other settlement")) as Hex;
const PAYER = "0x1111111111111111111111111111111111111111" as Address;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as Address;
const OTHER = "0x3333333333333333333333333333333333333333" as Address;
const SOURCE_TOKEN = "0x4444444444444444444444444444444444444444" as Address;
const SETTLEMENT_CONTRACT =
  "0x5555555555555555555555555555555555555555" as Address;
const SOURCE_CONTRACT =
  "0x6666666666666666666666666666666666666666" as Address;
const AMOUNT = 10_000_000n;
const NONCE = 42n;
const ARC_BLOCK = 123n;
const SOURCE_BLOCK = 88n;
const BLOCK_TIMESTAMP = 1_775_000_000n;

describe("PSP exact on-chain evidence readers", () => {
  beforeEach(() => {
    mocks.getArcReceipt.mockReset();
    mocks.getArcReceipt.mockResolvedValue(
      transactionReceipt({
        transactionHash: ARC_TX,
        blockHash: ARC_BLOCK_HASH,
        blockNumber: ARC_BLOCK,
        logs: [directTransferLog({ logIndex: 7 })],
      })
    );
    mocks.getArcBlock.mockReset();
    mocks.getArcBlock.mockResolvedValue(
      block(ARC_BLOCK_HASH, ARC_BLOCK)
    );
    mocks.getSourceReceipt.mockReset();
    mocks.getSourceReceipt.mockResolvedValue(
      transactionReceipt({
        transactionHash: SOURCE_TX,
        blockHash: SOURCE_BLOCK_HASH,
        blockNumber: SOURCE_BLOCK,
        logs: [sourceLog({ logIndex: 4 })],
      })
    );
    mocks.getSourceBlock.mockReset();
    mocks.getSourceBlock.mockResolvedValue(
      block(SOURCE_BLOCK_HASH, SOURCE_BLOCK)
    );
  });

  it("selects the one fully matching direct Transfer instead of the first token event", async () => {
    mocks.getArcReceipt.mockResolvedValue(
      transactionReceipt({
        transactionHash: ARC_TX,
        blockHash: ARC_BLOCK_HASH,
        blockNumber: ARC_BLOCK,
        logs: [
          directTransferLog({
            from: OTHER,
            to: OTHER,
            value: 1n,
            logIndex: 6,
          }),
          directTransferLog({ logIndex: 7 }),
        ],
      })
    );

    const result = await readDirectSettlementLog(
      directReceipt(),
      directRequest()
    );

    expect(result.settlement).toMatchObject({
      txHash: ARC_TX,
      blockNumber: ARC_BLOCK.toString(),
      settlementEvent: {
        contract: TOKENS.USDC.address,
        settlementId: ARC_TX,
        logIndex: 7,
      },
    });
    expect(mocks.getArcBlock).toHaveBeenCalledWith({
      blockHash: ARC_BLOCK_HASH,
    });
  });

  it("accepts an exact Circle Gateway attestation as payer-bound settlement evidence", async () => {
    mocks.getArcReceipt.mockResolvedValue(
      transactionReceipt({
        transactionHash: ARC_TX,
        blockHash: ARC_BLOCK_HASH,
        blockNumber: ARC_BLOCK,
        logs: [gatewayAttestationLog({ logIndex: 9 })],
      })
    );

    const result = await readDirectSettlementLog(
      { ...directReceipt(), directSettlementLogIndex: 9 },
      directRequest()
    );

    expect(result.settlement.settlementEvent).toMatchObject({
      contract: GATEWAY_MINTER_ADDRESS,
      settlementId: SETTLEMENT_ID,
      logIndex: 9,
    });
  });

  it("rejects a Gateway attestation whose onchain depositor is not the invoice payer", async () => {
    mocks.getArcReceipt.mockResolvedValue(
      transactionReceipt({
        transactionHash: ARC_TX,
        blockHash: ARC_BLOCK_HASH,
        blockNumber: ARC_BLOCK,
        logs: [gatewayAttestationLog({ depositor: OTHER, logIndex: 9 })],
      })
    );

    await expect(
      readDirectSettlementLog(
        { ...directReceipt(), directSettlementLogIndex: 9 },
        directRequest()
      )
    ).rejects.toThrow(/No exact settlement event/);
  });

  it("rejects a persisted direct log index that points at a different Transfer", async () => {
    mocks.getArcReceipt.mockResolvedValue(
      transactionReceipt({
        transactionHash: ARC_TX,
        blockHash: ARC_BLOCK_HASH,
        blockNumber: ARC_BLOCK,
        logs: [
          directTransferLog({
            from: OTHER,
            to: OTHER,
            value: 1n,
            logIndex: 6,
          }),
          directTransferLog({ logIndex: 7 }),
        ],
      })
    );

    await expect(
      readDirectSettlementLog(
        { ...directReceipt(), directSettlementLogIndex: 6 },
        directRequest()
      )
    ).rejects.toThrow(/No exact settlement event/);
  });

  it("rejects ambiguous direct Transfers when legacy evidence has no stored index", async () => {
    mocks.getArcReceipt.mockResolvedValue(
      transactionReceipt({
        transactionHash: ARC_TX,
        blockHash: ARC_BLOCK_HASH,
        blockNumber: ARC_BLOCK,
        logs: [
          directTransferLog({ logIndex: 6 }),
          directTransferLog({ logIndex: 7 }),
        ],
      })
    );

    await expect(
      readDirectSettlementLog(directReceipt(), directRequest())
    ).rejects.toThrow(/Ambiguous settlement event/);
  });

  it("never invents a log index for an exact direct Transfer", async () => {
    mocks.getArcReceipt.mockResolvedValue(
      transactionReceipt({
        transactionHash: ARC_TX,
        blockHash: ARC_BLOCK_HASH,
        blockNumber: ARC_BLOCK,
        logs: [directTransferLog({ logIndex: undefined })],
      })
    );

    await expect(
      readDirectSettlementLog(directReceipt(), directRequest())
    ).rejects.toThrow(/missing a valid global log index/);
  });

  it("rejects reverted, wrong-hash, and wrong-block Arc receipts", async () => {
    mocks.getArcReceipt.mockResolvedValueOnce(
      transactionReceipt({
        status: "reverted",
        transactionHash: ARC_TX,
        blockHash: ARC_BLOCK_HASH,
        blockNumber: ARC_BLOCK,
        logs: [directTransferLog({ logIndex: 7 })],
      })
    );
    await expect(
      readDirectSettlementLog(directReceipt(), directRequest())
    ).rejects.toThrow(/transaction reverted/);

    mocks.getArcReceipt.mockResolvedValueOnce(
      transactionReceipt({
        transactionHash: OTHER_TX,
        blockHash: ARC_BLOCK_HASH,
        blockNumber: ARC_BLOCK,
        logs: [],
      })
    );
    await expect(
      readDirectSettlementLog(directReceipt(), directRequest())
    ).rejects.toThrow(/transaction hash does not match/);

    mocks.getArcReceipt.mockResolvedValueOnce(
      transactionReceipt({
        transactionHash: ARC_TX,
        blockHash: ARC_BLOCK_HASH,
        blockNumber: ARC_BLOCK + 1n,
        logs: [],
      })
    );
    await expect(
      readDirectSettlementLog(directReceipt(), directRequest())
    ).rejects.toThrow(/block number does not match persisted/);
  });

  it("rejects a block or log that is not bound to the receipt block hash", async () => {
    mocks.getArcBlock.mockResolvedValueOnce(
      block(OTHER_BLOCK_HASH, ARC_BLOCK)
    );
    await expect(
      readDirectSettlementLog(directReceipt(), directRequest())
    ).rejects.toThrow(/block hash or number does not match/);

    mocks.getArcReceipt.mockResolvedValueOnce(
      transactionReceipt({
        transactionHash: ARC_TX,
        blockHash: ARC_BLOCK_HASH,
        blockNumber: ARC_BLOCK,
        logs: [
          directTransferLog({
            logIndex: 7,
            blockHash: OTHER_BLOCK_HASH,
          }),
        ],
      })
    );
    await expect(
      readDirectSettlementLog(directReceipt(), directRequest())
    ).rejects.toThrow(/not part of the exact transaction receipt block/);
  });

  it("selects and exposes the exact persisted QrPaymentInitiated evidence", async () => {
    mocks.getSourceReceipt.mockResolvedValue(
      transactionReceipt({
        transactionHash: SOURCE_TX,
        blockHash: SOURCE_BLOCK_HASH,
        blockNumber: SOURCE_BLOCK,
        logs: [
          sourceLog({
            requestId: keccak256(stringToHex("other request")),
            logIndex: 3,
          }),
          sourceLog({ logIndex: 4 }),
        ],
      })
    );

    const result = await readSourcePaymentLog(
      crossChainReceipt(),
      crossChainRequest(),
      SOURCE_CONTRACT
    );

    expect(result.source).toEqual({
      chainId: BASE_SEPOLIA_CHAIN_ID,
      txHash: SOURCE_TX,
      blockNumber: SOURCE_BLOCK.toString(),
      payer: PAYER,
      token: SOURCE_TOKEN,
      amount: AMOUNT.toString(),
    });
    expect(result.evidence).toMatchObject({
      requestId: requestIdToBytes32(REQUEST_ID),
      recipient: RECIPIENT,
      destinationChainId: ARC_CHAIN_ID,
      nonce: NONCE,
      logIndex: 4,
    });
    expect(mocks.getSourceBlock).toHaveBeenCalledWith({
      blockHash: SOURCE_BLOCK_HASH,
    });
  });

  it.each([
    {
      name: "request id",
      overrides: { requestId: keccak256(stringToHex("wrong request")) },
    },
    { name: "payer", overrides: { payer: OTHER } },
    { name: "recipient", overrides: { recipient: OTHER } },
    { name: "amount", overrides: { amount: AMOUNT - 1n } },
    { name: "destination chain", overrides: { destinationChainId: 1n } },
  ])("rejects source evidence with a wrong $name", async ({ overrides }) => {
    mocks.getSourceReceipt.mockResolvedValue(
      transactionReceipt({
        transactionHash: SOURCE_TX,
        blockHash: SOURCE_BLOCK_HASH,
        blockNumber: SOURCE_BLOCK,
        logs: [sourceLog({ ...overrides, logIndex: 4 })],
      })
    );

    await expect(
      readSourcePaymentLog(
        crossChainReceipt(),
        crossChainRequest(),
        SOURCE_CONTRACT
      )
    ).rejects.toThrow(/No exact QrPaymentInitiated/);
  });

  it("rejects a source event whose persisted block or log index does not match", async () => {
    await expect(
      readSourcePaymentLog(
        crossChainReceipt(),
        {
          ...crossChainRequest(),
          settlement: {
            ...crossChainRequest().settlement!,
            sourceBlockNumber: "89",
          },
        },
        SOURCE_CONTRACT
      )
    ).rejects.toThrow(/block number does not match persisted/);

    await expect(
      readSourcePaymentLog(
        crossChainReceipt(),
        {
          ...crossChainRequest(),
          settlement: {
            ...crossChainRequest().settlement!,
            sourceLogIndex: 5,
          },
        },
        SOURCE_CONTRACT
      )
    ).rejects.toThrow(/No exact QrPaymentInitiated/);
  });

  it("rejects ambiguous or index-less exact source events", async () => {
    mocks.getSourceReceipt.mockResolvedValueOnce(
      transactionReceipt({
        transactionHash: SOURCE_TX,
        blockHash: SOURCE_BLOCK_HASH,
        blockNumber: SOURCE_BLOCK,
        logs: [
          sourceLog({ logIndex: 4 }),
          sourceLog({ logIndex: 4 }),
        ],
      })
    );
    await expect(
      readSourcePaymentLog(
        crossChainReceipt(),
        crossChainRequest(),
        SOURCE_CONTRACT
      )
    ).rejects.toThrow(/Ambiguous QrPaymentInitiated/);

    mocks.getSourceReceipt.mockResolvedValueOnce(
      transactionReceipt({
        transactionHash: SOURCE_TX,
        blockHash: SOURCE_BLOCK_HASH,
        blockNumber: SOURCE_BLOCK,
        logs: [sourceLog({ logIndex: undefined })],
      })
    );
    await expect(
      readSourcePaymentLog(
        crossChainReceipt(),
        crossChainRequest(),
        SOURCE_CONTRACT
      )
    ).rejects.toThrow(/missing a valid global log index/);
  });

  it("binds QrPaymentSettled to every invoice and source-event field", async () => {
    const source = await readSourcePaymentLog(
      crossChainReceipt(),
      crossChainRequest(),
      SOURCE_CONTRACT
    );
    mocks.getArcReceipt.mockResolvedValue(
      transactionReceipt({
        transactionHash: ARC_TX,
        blockHash: ARC_BLOCK_HASH,
        blockNumber: ARC_BLOCK,
        logs: [
          settlementLog({
            settlementId: OTHER_SETTLEMENT_ID,
            requestId: keccak256(stringToHex("other request")),
            logIndex: 8,
          }),
          settlementLog({ logIndex: 9 }),
        ],
      })
    );

    const result = await readCrossChainSettlementLog(
      crossChainReceipt(),
      crossChainRequest(),
      SETTLEMENT_CONTRACT,
      source.evidence
    );

    expect(result.settlement).toMatchObject({
      txHash: ARC_TX,
      blockNumber: ARC_BLOCK.toString(),
      settlementEvent: {
        contract: SETTLEMENT_CONTRACT,
        settlementId: SETTLEMENT_ID,
        logIndex: 9,
      },
    });
    expect(result.evidence).toMatchObject({
      requestId: requestIdToBytes32(REQUEST_ID),
      recipient: RECIPIENT,
      sourceChainId: BASE_SEPOLIA_CHAIN_ID,
      payer: PAYER,
      sourceToken: SOURCE_TOKEN,
      destinationToken: TOKENS.USDC.address,
      amount: AMOUNT,
      nonce: NONCE,
      logIndex: 9,
    });
  });

  it.each([
    {
      name: "request id",
      overrides: { requestId: keccak256(stringToHex("wrong request")) },
    },
    { name: "recipient", overrides: { recipient: OTHER } },
    { name: "source chain", overrides: { sourceChainId: 10_143 } },
    { name: "payer", overrides: { payer: OTHER } },
    { name: "source token", overrides: { sourceToken: OTHER } },
    { name: "destination token", overrides: { destinationToken: OTHER } },
    { name: "amount", overrides: { amount: AMOUNT - 1n } },
    { name: "nonce", overrides: { nonce: NONCE + 1n } },
  ])(
    "rejects settlement evidence with a wrong $name",
    async ({ overrides }) => {
      mocks.getArcReceipt.mockResolvedValue(
        transactionReceipt({
          transactionHash: ARC_TX,
          blockHash: ARC_BLOCK_HASH,
          blockNumber: ARC_BLOCK,
          logs: [settlementLog({ ...overrides, logIndex: 9 })],
        })
      );

      await expect(
        readCrossChainSettlementLog(
          crossChainReceipt(),
          crossChainRequest(),
          SETTLEMENT_CONTRACT,
          exactSourceEvidence()
        )
      ).rejects.toThrow(/No exact QrPaymentSettled/);
    }
  );

  it("rejects ambiguous or index-less exact settlement events", async () => {
    mocks.getArcReceipt.mockResolvedValueOnce(
      transactionReceipt({
        transactionHash: ARC_TX,
        blockHash: ARC_BLOCK_HASH,
        blockNumber: ARC_BLOCK,
        logs: [
          settlementLog({ logIndex: 8 }),
          settlementLog({ logIndex: 9 }),
        ],
      })
    );
    await expect(
      readCrossChainSettlementLog(
        crossChainReceipt(),
        crossChainRequest(),
        SETTLEMENT_CONTRACT,
        exactSourceEvidence()
      )
    ).rejects.toThrow(/Ambiguous QrPaymentSettled/);

    mocks.getArcReceipt.mockResolvedValueOnce(
      transactionReceipt({
        transactionHash: ARC_TX,
        blockHash: ARC_BLOCK_HASH,
        blockNumber: ARC_BLOCK,
        logs: [settlementLog({ logIndex: undefined })],
      })
    );
    await expect(
      readCrossChainSettlementLog(
        crossChainReceipt(),
        crossChainRequest(),
        SETTLEMENT_CONTRACT,
        exactSourceEvidence()
      )
    ).rejects.toThrow(/missing a valid global log index/);
  });
});

function directRequest(): PaymentRequest {
  return {
    id: REQUEST_ID,
    recipient: RECIPIENT,
    token: "USDC",
    amount: "10",
    label: "Invoice",
    createdAt: "2026-07-29T00:00:00.000Z",
    startBlock: "1",
    status: "paid",
    txHash: ARC_TX,
  };
}

function directReceipt(): Receipt {
  return {
    requestId: REQUEST_ID,
    txHash: ARC_TX,
    from: PAYER,
    to: RECIPIENT,
    token: "USDC",
    amount: "10.00",
    blockNumber: ARC_BLOCK.toString(),
    confirmedAt: "2026-07-29T00:01:00.000Z",
    explorerUrl: "https://explorer.example/tx",
    chainId: ARC_CHAIN_ID,
  };
}

function crossChainRequest(): PaymentRequest {
  return {
    ...directRequest(),
    destinationChainId: ARC_CHAIN_ID,
    allowedSourceChainIds: [BASE_SEPOLIA_CHAIN_ID],
    settlement: {
      destinationChainId: ARC_CHAIN_ID,
      sourceChainId: BASE_SEPOLIA_CHAIN_ID,
      sourceTxHash: SOURCE_TX,
      sourceBlockNumber: SOURCE_BLOCK.toString(),
      sourceLogIndex: 4,
      destinationTxHash: ARC_TX,
      destinationBlockNumber: ARC_BLOCK.toString(),
      stage: "settled",
    },
  };
}

function crossChainReceipt(): Receipt {
  return {
    ...directReceipt(),
    sourceChainId: BASE_SEPOLIA_CHAIN_ID,
    sourceTxHash: SOURCE_TX,
  };
}

function exactSourceEvidence(): SourcePaymentEvidence {
  return {
    requestId: requestIdToBytes32(REQUEST_ID),
    payer: PAYER,
    recipient: RECIPIENT,
    sourceToken: SOURCE_TOKEN,
    amount: AMOUNT,
    destinationChainId: ARC_CHAIN_ID,
    nonce: NONCE,
    logIndex: 4,
  };
}

function directTransferLog({
  from = PAYER,
  to = RECIPIENT,
  value = AMOUNT,
  logIndex,
  blockHash = ARC_BLOCK_HASH,
}: {
  from?: Address;
  to?: Address;
  value?: bigint;
  logIndex: number | undefined;
  blockHash?: Hash;
}) {
  return receiptLog({
    address: TOKENS.USDC.address,
    transactionHash: ARC_TX,
    blockHash,
    blockNumber: ARC_BLOCK,
    logIndex,
    topics: encodeEventTopics({
      abi: [TRANSFER_EVENT],
      eventName: "Transfer",
      args: { from, to },
    }) as unknown as [Hex, ...Hex[]],
    data: encodeAbiParameters(parseAbiParameters("uint256"), [value]),
  });
}

function gatewayAttestationLog({
  depositor = PAYER,
  signer = depositor,
  recipient = RECIPIENT,
  value = AMOUNT,
  logIndex,
}: {
  depositor?: Address;
  signer?: Address;
  recipient?: Address;
  value?: bigint;
  logIndex: number | undefined;
}) {
  return receiptLog({
    address: GATEWAY_MINTER_ADDRESS,
    transactionHash: ARC_TX,
    blockHash: ARC_BLOCK_HASH,
    blockNumber: ARC_BLOCK,
    logIndex,
    topics: encodeEventTopics({
      abi: [GATEWAY_ATTESTATION_USED_EVENT],
      eventName: "AttestationUsed",
      args: {
        token: TOKENS.USDC.address,
        recipient,
        transferSpecHash: SETTLEMENT_ID,
      },
    }) as unknown as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      parseAbiParameters("uint32,bytes32,bytes32,uint256"),
      [ARC_GATEWAY_DOMAIN, pad(depositor, { size: 32 }), pad(signer, { size: 32 }), value]
    ),
  });
}

function sourceLog({
  requestId = requestIdToBytes32(REQUEST_ID),
  payer = PAYER,
  recipient = RECIPIENT,
  sourceToken = SOURCE_TOKEN,
  amount = AMOUNT,
  destinationChainId = BigInt(ARC_CHAIN_ID),
  nonce = NONCE,
  logIndex,
}: {
  requestId?: Hex;
  payer?: Address;
  recipient?: Address;
  sourceToken?: Address;
  amount?: bigint;
  destinationChainId?: bigint;
  nonce?: bigint;
  logIndex: number | undefined;
}) {
  return receiptLog({
    address: SOURCE_CONTRACT,
    transactionHash: SOURCE_TX,
    blockHash: SOURCE_BLOCK_HASH,
    blockNumber: SOURCE_BLOCK,
    logIndex,
    topics: encodeEventTopics({
      abi: [INITIATED_EVENT],
      eventName: "QrPaymentInitiated",
      args: { requestId, payer, recipient },
    }) as unknown as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      parseAbiParameters("address,uint256,uint256,uint256"),
      [sourceToken, amount, destinationChainId, nonce]
    ),
  });
}

function settlementLog({
  settlementId = SETTLEMENT_ID,
  requestId = requestIdToBytes32(REQUEST_ID),
  recipient = RECIPIENT,
  sourceChainId = BASE_SEPOLIA_CHAIN_ID,
  payer = PAYER,
  sourceToken = SOURCE_TOKEN,
  destinationToken = TOKENS.USDC.address,
  amount = AMOUNT,
  nonce = NONCE,
  logIndex,
}: {
  settlementId?: Hex;
  requestId?: Hex;
  recipient?: Address;
  sourceChainId?: number;
  payer?: Address;
  sourceToken?: Address;
  destinationToken?: Address;
  amount?: bigint;
  nonce?: bigint;
  logIndex: number | undefined;
}) {
  return receiptLog({
    address: SETTLEMENT_CONTRACT,
    transactionHash: ARC_TX,
    blockHash: ARC_BLOCK_HASH,
    blockNumber: ARC_BLOCK,
    logIndex,
    topics: encodeEventTopics({
      abi: [SETTLED_EVENT],
      eventName: "QrPaymentSettled",
      args: { settlementId, requestId, recipient },
    }) as unknown as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      parseAbiParameters(
        "uint32,address,address,address,uint256,uint256"
      ),
      [
        sourceChainId,
        payer,
        sourceToken,
        destinationToken,
        amount,
        nonce,
      ]
    ),
  });
}

function receiptLog(input: {
  address: Address;
  transactionHash: Hash;
  blockHash: Hash;
  blockNumber: bigint;
  logIndex: number | undefined;
  topics: readonly Hex[];
  data: Hex;
}) {
  return {
    address: input.address,
    transactionHash: input.transactionHash,
    blockHash: input.blockHash,
    blockNumber: input.blockNumber,
    logIndex: input.logIndex,
    transactionIndex: 0,
    removed: false,
    topics: [...input.topics] as [] | [Hex, ...Hex[]],
    data: input.data,
  };
}

function transactionReceipt({
  status = "success",
  transactionHash,
  blockHash,
  blockNumber,
  logs,
}: {
  status?: "success" | "reverted";
  transactionHash: Hash;
  blockHash: Hash;
  blockNumber: bigint;
  logs: ReturnType<typeof receiptLog>[];
}): TransactionReceipt {
  return {
    status,
    transactionHash,
    blockHash,
    blockNumber,
    logs,
  } as unknown as TransactionReceipt;
}

function block(hash: Hash, number: bigint) {
  return {
    hash,
    number,
    timestamp: BLOCK_TIMESTAMP,
  };
}
