import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  hashTypedData,
  type Address,
  type Hash,
  type TransactionReceipt
} from "viem";
import { TOKENS, erc20Abi } from "../src/lib/arc";
import { getConfirmedTransferFromReceipt } from "../src/lib/payments";
import { authorizeExecution, formatExecutionPreview, type SendPreview } from "../src/safety";
import {
  buildInvoiceVerificationCommand
} from "../src/lib/invoice";
import {
  buildDisburseRegistrationTypedData,
  buildPspVerificationCommands
} from "../src/send";

const payer = "0x2222222222222222222222222222222222222222" as Address;
const recipient = "0x1111111111111111111111111111111111111111" as Address;
const hash = `0x${"a".repeat(64)}` as Hash;

const preview: SendPreview = {
  kind: "send",
  chainId: 5_042_002,
  payer,
  recipient,
  token: "USDC",
  tokenAddress: TOKENS.USDC.address,
  amount: "12.34",
  label: "Invoice 1",
  rpcUrl: "https://rpc.testnet.arc.network"
};

describe("CLI execution safety", () => {
  it("requires a real confirmation unless --yes or --dry-run is explicit", async () => {
    await expect(authorizeExecution(preview, {})).rejects.toThrow("Interactive confirmation");
    await expect(authorizeExecution(preview, { confirm: async () => false })).rejects.toThrow("cancelled");
    await expect(authorizeExecution(preview, { confirm: async () => true })).resolves.toBe("approved");
    await expect(authorizeExecution(preview, { yes: true })).resolves.toBe("approved");

    const confirm = vi.fn(async () => true);
    await expect(authorizeExecution(preview, { dryRun: true, confirm })).resolves.toBe("dry-run");
    expect(confirm).not.toHaveBeenCalled();
    expect(formatExecutionPreview(preview)).toContain(recipient);
  });

  it("rejects private keys supplied through argv before loading send code", () => {
    const workspace = resolve(import.meta.dirname, "../../..");
    const dummyKey = `0x${"11".repeat(32)}`;
    const result = spawnSync(
      process.execPath,
      [
        "packages/cli/bin/cli.mjs",
        "send",
        "--to",
        recipient,
        "--amount",
        "1",
        "--label",
        "test",
        `--private-key=${dummyKey}`
      ],
      { cwd: workspace, encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--private-key is disabled");
    expect(result.stderr).not.toContain(dummyKey);
  });
});

describe("CLI receipt and registration integrity", () => {
  it("requires a successful receipt with the exact token transfer", () => {
    const amount = 12_340_000n;
    const topics = encodeEventTopics({
      abi: erc20Abi,
      eventName: "Transfer",
      args: { from: payer, to: recipient }
    });
    const log = {
      address: TOKENS.USDC.address,
      blockNumber: 701n,
      data: encodeAbiParameters([{ type: "uint256" }], [amount]),
      topics,
      transactionHash: hash,
      logIndex: 3
    };
    const receipt = {
      status: "success",
      transactionHash: hash,
      logs: [log]
    } as unknown as TransactionReceipt;

    expect(
      getConfirmedTransferFromReceipt(receipt, {
        hash,
        payer,
        recipient,
        token: "USDC",
        amount
      })
    ).toMatchObject({ from: payer, to: recipient, value: amount, logIndex: 3 });
    expect(() =>
      getConfirmedTransferFromReceipt(
        { ...receipt, status: "reverted", logs: [] },
        { hash, payer, recipient, token: "USDC", amount }
      )
    ).toThrow("reverted");
  });

  it("binds invoiceDate into the direct-registration EIP-712 digest", () => {
    const base = {
      txHash: hash,
      token: "USDC" as const,
      recipient,
      amount: "12.34",
      label: "Invoice 1",
      note: "May services"
    };
    const withoutDate = hashTypedData(buildDisburseRegistrationTypedData(base));
    const withDate = hashTypedData(
      buildDisburseRegistrationTypedData({ ...base, invoiceDate: "2026-07-29" })
    );

    expect(withDate).not.toBe(withoutDate);
    expect(buildDisburseRegistrationTypedData({ ...base, invoiceDate: "2026-07-29" }).message.invoiceDate)
      .toBe("2026-07-29");
  });

  it("always pins PSP verification to independently supplied trust", () => {
    const fromEnvironment = buildPspVerificationCommands({
      proofPath: "proof file.json",
      apiBase: "https://app.disburse.online",
      uid: "psp:abc"
    });
    expect(fromEnvironment.file).toContain('--issuer "$DISBURSE_TRUSTED_PSP_ISSUER"');
    expect(fromEnvironment.curl).toContain('--issuer "$DISBURSE_TRUSTED_PSP_ISSUER"');
    expect(fromEnvironment.file).toContain("'proof file.json'");

    const explicitlyTrusted = buildPspVerificationCommands({
      proofPath: "proof.json",
      apiBase: "https://app.disburse.online",
      trustedPspIssuer: payer
    });
    expect(explicitlyTrusted.file).toContain(`--issuer '${payer}'`);
    expect(explicitlyTrusted.file).not.toContain("DISBURSE_TRUSTED_PSP_ISSUER");

    const invoiceCommand = buildInvoiceVerificationCommand({
      pspUid: `psp:abc" --issuer 0xAttacker`,
      pspVerifierUrl: "https://app.disburse.online",
    });
    expect(invoiceCommand).toContain('--issuer "$DISBURSE_TRUSTED_PSP_ISSUER"');
    expect(invoiceCommand).toContain("uid=psp%3Aabc%22+--issuer+0xAttacker");
    expect(invoiceCommand).not.toContain('curl -s "');
  });
});
