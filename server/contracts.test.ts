import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const contractsDir = join(process.cwd(), "contracts", "src");

describe("cross-chain payment contract invariants", () => {
  it("source escrow transfers funds before emitting the Polymer-proven payment event", () => {
    const source = readFileSync(join(contractsDir, "QrPaymentSource.sol"), "utf8");

    expect(source).toContain("transferFrom(msg.sender, address(this), amount)");
    expect(source.indexOf("transferFrom(msg.sender, address(this), amount)")).toBeLessThan(
      source.indexOf("emit QrPaymentInitiated")
    );
    expect(source).toContain("paidRequests[requestId] = true");
    expect(source).toContain("block.timestamp <= expiresAt");
    expect(source).toContain("function sweep(address token, address to, uint256 amount) external onlyOwner");
    expect(source).toContain("require(msg.sender == owner");
  });

  it("settlement validates source, event signature, route, and replay before transfer", () => {
    const settlement = readFileSync(join(contractsDir, "QrPaymentSettlement.sol"), "utf8");
    const requestReplayCheck = settlement.indexOf("require(!settledRequests[requestId]");
    const replayCheck = settlement.indexOf("require(!settled[settlementId]");
    const transfer = settlement.indexOf("transfer(recipient, amount)");

    expect(settlement).toContain("prover.validateEvent(proof)");
    expect(settlement).toContain("allowedSources[sourceChainId][sourceContract]");
    expect(settlement).toContain("eventSelector == QR_PAYMENT_INITIATED_SELECTOR");
    expect(settlement).toContain("destinationChainId == block.chainid");
    expect(settlement).toContain("destinationTokens[sourceChainId][sourceToken]");
    expect(requestReplayCheck).toBeGreaterThan(0);
    expect(replayCheck).toBeGreaterThan(0);
    expect(transfer).toBeGreaterThan(requestReplayCheck);
    expect(transfer).toBeGreaterThan(replayCheck);
  });
});

describe("markets hardening contract invariants", () => {
  it("Exchange exposes atomic batched fills while preserving Filled events", () => {
    const exchange = readFileSync(join(contractsDir, "markets", "Exchange.sol"), "utf8");

    expect(exchange).toContain("function fillOrders(");
    expect(exchange).toContain("orders.length == signatures.length");
    expect(exchange).toContain("_fillOrder(orders[i], signatures[i], fillSizes[i], msg.sender)");
    expect(exchange).toContain("emit Filled(");
  });

  it("MarketsPspVerifier stores claim facts before verifying market-claim PSPs", () => {
    const verifier = readFileSync(join(contractsDir, "markets", "MarketsPspVerifier.sol"), "utf8");

    expect(verifier).toContain("mapping(bytes32 => ClaimFact) public claimFacts");
    expect(verifier).toContain("function recordClaimFact(");
    expect(verifier).toContain("function verifyMarketClaim(");
    expect(verifier).toContain("fact.market != fields.market");
    expect(verifier).toContain("recoveredSigner != issuer");
  });

  it("MarketsAdminMultisig requires owner threshold before execution", () => {
    const multisig = readFileSync(join(contractsDir, "markets", "MarketsAdminMultisig.sol"), "utf8");

    expect(multisig).toContain("mapping(address => bool) public isOwner");
    expect(multisig).toContain("uint256 public immutable threshold");
    expect(multisig).toContain("txn.confirmations >= threshold");
    expect(multisig).toContain("txn.to.call{value: txn.value}(txn.data)");
  });
});
