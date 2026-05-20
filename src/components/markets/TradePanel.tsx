import { useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { cn } from "../../lib/utils";
import { useDisburseDynamicWallet } from "../../lib/dynamic";
import {
  microsToUsdcString,
  type Market,
  type Outcome
} from "../../lib/markets/types";
import {
  indexFillsTx,
  MarketsApiError,
  postSignedOrder,
  type RawOpenOrder,
  type WireOrder
} from "../../lib/markets/api";
import { getMarketsConfig } from "../../lib/markets/config";
import { PRICE_SCALE, randomSalt, signOrder, type ClientOrder } from "../../lib/markets/sign";
import {
  deriveTakerLimitPrice,
  ensureUsdcApproval,
  planTakerFills,
  takeOrder
} from "../../lib/markets/onchain";

type Props = {
  market: Market;
  outcome: Outcome;
  onOutcomeChange: (next: Outcome) => void;
  /**
   * Live snapshot of open orders for this market. Required for Market mode,
   * where the client reads the book to pick fillable maker orders.
   */
  rawOrders: RawOpenOrder[];
};

type OrderType = "LIMIT" | "MARKET";

type SubmitState =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "posting" }
  | { kind: "approving" }
  | { kind: "filling" }
  | { kind: "indexing" }
  | { kind: "ok"; orderHash: string }
  | { kind: "filled"; txHash: string; sizeMicros: number; totalMicros: number }
  | { kind: "error"; message: string };

/** Slippage tolerance for market orders, in basis points (5%). Worst-case price
 * the taker accepts = mid ± 5%. Kept conservative for v1 — book is thin. */
const MARKET_SLIPPAGE_BPS = 500n;

/**
 * TradePanel — BUY-only entry surface.
 *
 * UX model (post-simplification):
 *   - Two big buttons: BUY YES, BUY NO. Pick a side.
 *   - Order type: Market (sweeps the book now) or Limit (rests until taker).
 *   - We show three numbers so the bet feels concrete:
 *       Total       — what leaves your wallet right now
 *       Shares      — what you receive (1 share = $1 redemption value)
 *       If wins     — max payout if your side wins (== shares × $1)
 *
 * Selling is NOT here. Position holders sell from
 * `MyPositionsPage` → `PositionCard` so the entry path stays single-purpose.
 */
export default function TradePanel({ market, outcome, onOutcomeChange, rawOrders }: Props) {
  // Default to MARKET — that's the "click to actually trade shares" path.
  // Limit is the maker path for users who want to set their own price.
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [priceStr, setPriceStr] = useState<string>(() =>
    priceForOutcome(market, outcome)
  );
  const [sizeStr, setSizeStr] = useState<string>("10");
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });

  const wallet = useDisburseDynamicWallet();
  const account = wallet.getAccount?.();
  const hasWallet = Boolean(account);

  const priceMicros = useMemo(() => parseUsdToMicros(priceStr), [priceStr]);
  const sizeMicros = useMemo(() => parseUsdToMicros(sizeStr), [sizeStr]);

  const priceOk = priceMicros !== undefined && priceMicros > 0 && priceMicros < 1_000_000;
  const sizeOk = sizeMicros !== undefined && sizeMicros > 0;

  // For Market mode the "estimated total" is the size walked against the
  // current book at the best opposite-side prices. We compute it here so the
  // Total row stays in sync with the actual on-chain sweep.
  const marketPlan = useMemo(() => {
    if (orderType !== "MARKET" || !sizeOk) return undefined;
    const limit = deriveTakerLimitPrice({
      rawOrders,
      takerAddress: account ?? "0x0000000000000000000000000000000000000000",
      outcome,
      intent: "BUY",
      slippageBps: MARKET_SLIPPAGE_BPS,
      fallbackPriceMicros: BigInt(outcome === "YES" ? market.yesPriceMicros : market.noPriceMicros)
    });
    return planTakerFills({
      rawOrders,
      takerAddress: account ?? "0x0000000000000000000000000000000000000000",
      outcome,
      intent: "BUY",
      sizeMicros: BigInt(sizeMicros!),
      limitPriceMicros: limit
    });
  }, [orderType, sizeOk, sizeMicros, account, rawOrders, outcome, market.yesPriceMicros, market.noPriceMicros]);

  const marketHasLiquidity = (marketPlan?.length ?? 0) > 0;
  const marketSweptSize = marketPlan?.reduce((acc, p) => acc + p.fillSize, 0n) ?? 0n;
  const marketSweptUsdc =
    marketPlan?.reduce(
      (acc, p) => acc + (BigInt(p.order.price) * p.fillSize) / 1_000_000n,
      0n
    ) ?? 0n;

  const totalMicros =
    orderType === "LIMIT"
      ? priceOk && sizeOk
        ? Math.floor((priceMicros! * sizeMicros!) / 1_000_000)
        : 0
      : Number(marketSweptUsdc);

  // Max payout = shares × $1. For Market mode, "shares" = what the sweep
  // actually filled (may be less than requested if book ran out); for
  // Limit, it's the size the user typed.
  const sharesMicros =
    orderType === "LIMIT" ? (sizeOk ? sizeMicros! : 0) : Number(marketSweptSize);
  const maxPayoutMicros = sharesMicros;
  const profitMicros = maxPayoutMicros - totalMicros;
  const profitPct =
    totalMicros > 0 ? (profitMicros / totalMicros) * 100 : 0;

  const submitting =
    submit.kind === "signing" ||
    submit.kind === "posting" ||
    submit.kind === "approving" ||
    submit.kind === "filling" ||
    submit.kind === "indexing";

  const canSubmit =
    orderType === "LIMIT"
      ? priceOk && sizeOk && hasWallet && !submitting
      : sizeOk && hasWallet && marketHasLiquidity && !submitting;

  async function handleSubmit() {
    if (!canSubmit || !account) return;

    if (orderType === "MARKET") {
      await handleMarketSubmit();
      return;
    }

    setSubmit({ kind: "approving" });

    try {
      const { exchangeAddress } = getMarketsConfig();
      const provider = await wallet.getEthereumProvider();
      if (!provider) {
        throw new Error("Wallet provider not available. Reconnect and try again.");
      }

      await ensureUsdcApproval(provider, account, exchangeAddress, BigInt(totalMicros));
      setSubmit({ kind: "signing" });

      const order: ClientOrder = {
        maker: account,
        market: market.onchainAddress,
        outcome: outcome === "YES" ? 1 : 0,
        side: 0, // BUY
        price: BigInt(priceMicros!),
        size: BigInt(sizeMicros!),
        expiry: BigInt(Math.floor(Date.now() / 1000) + 24 * 60 * 60),
        salt: randomSalt()
      };

      const signature = await signOrder(provider, order, exchangeAddress);
      setSubmit({ kind: "posting" });

      const wire: WireOrder = {
        maker: order.maker,
        market: order.market,
        outcome: order.outcome,
        side: order.side,
        price: order.price.toString(),
        size: order.size.toString(),
        expiry: order.expiry.toString(),
        salt: order.salt.toString(),
        signature
      };
      const result = await postSignedOrder(wire);
      setSubmit({ kind: "ok", orderHash: result.hash });
      setSizeStr("");
    } catch (err) {
      const message =
        err instanceof MarketsApiError
          ? `Order rejected (${err.status}): ${err.message}`
          : err instanceof Error
            ? `Order failed: ${err.message}`
            : "Unknown error";
      setSubmit({ kind: "error", message });
    }
  }

  /**
   * Market submit: walk the live orderbook and call Exchange.fillOrders
   * directly. This is the only path that actually moves shares on-chain
   * during this MVP — limit orders sit on the book until a taker arrives.
   */
  async function handleMarketSubmit() {
    if (!account || !sizeOk) return;
    setSubmit({ kind: "approving" });

    try {
      const provider = await wallet.getEthereumProvider();
      if (!provider) {
        throw new Error("Wallet provider not available. Reconnect and try again.");
      }

      // Slippage-adjusted ceiling from the current best ask. Same math as
      // `marketPlan` above; recompute here so a fast click does not rely on a
      // stale memo.
      const limit = deriveTakerLimitPrice({
        rawOrders,
        takerAddress: account,
        outcome,
        intent: "BUY",
        slippageBps: MARKET_SLIPPAGE_BPS,
        fallbackPriceMicros: BigInt(outcome === "YES" ? market.yesPriceMicros : market.noPriceMicros)
      });

      setSubmit({ kind: "filling" });
      const result = await takeOrder(provider, {
        taker: account,
        market: market.onchainAddress,
        outcome,
        intent: "BUY",
        sizeMicros: BigInt(sizeMicros!),
        limitPriceMicros: limit,
        rawOrders
      });

      // Tell the backend to index this tx's Filled events immediately, so
      // positions + fills update without waiting for a poll.
      setSubmit({ kind: "indexing" });
      try {
        await indexFillsTx(result.txHash);
      } catch {
        // Indexer failures are non-fatal — the on-chain tx is the source of
        // truth. The cron will pick it up later. We still surface the
        // successful fill below.
      }

      setSubmit({
        kind: "filled",
        txHash: result.txHash,
        sizeMicros: Number(result.filledSizeMicros),
        totalMicros: Number(result.totalUsdcMicros)
      });
      setSizeStr("");
    } catch (err) {
      const message =
        err instanceof MarketsApiError
          ? `Index failed (${err.status}): ${err.message}`
          : err instanceof Error
            ? err.message
            : "Unknown error";
      setSubmit({ kind: "error", message });
    }
  }

  function handlePickOutcome(next: Outcome) {
    onOutcomeChange(next);
    setPriceStr(priceForOutcome(market, next));
    setSubmit({ kind: "idle" });
  }

  const yesPriceLabel = formatPriceLabel(market.yesPriceMicros);
  const noPriceLabel = formatPriceLabel(market.noPriceMicros);

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
          Place a bet
        </p>
        {account && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
            {`${account.slice(0, 6)}…${account.slice(-4)}`}
          </span>
        )}
      </div>

      {/* Pick a side. Two big buttons replace the old BUY/SELL toggle pair —
          selling lives on the positions page. */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <OutcomeButton
          label="Buy YES"
          priceLabel={yesPriceLabel}
          tone="green"
          active={outcome === "YES"}
          onClick={() => handlePickOutcome("YES")}
        />
        <OutcomeButton
          label="Buy NO"
          priceLabel={noPriceLabel}
          tone="red"
          active={outcome === "NO"}
          onClick={() => handlePickOutcome("NO")}
        />
      </div>

      {/* Order type toggle. Market sweeps the live book on-chain; Limit posts
          a signed maker order that rests until a taker arrives. */}
      <div className="mb-3 inline-flex w-full rounded-md border border-[var(--line)] p-0.5">
        <OrderTypeTab
          label="Market"
          active={orderType === "MARKET"}
          onClick={() => setOrderType("MARKET")}
        />
        <OrderTypeTab
          label="Limit"
          active={orderType === "LIMIT"}
          onClick={() => setOrderType("LIMIT")}
        />
      </div>

      {orderType === "LIMIT" && (
        <Field
          label="Limit price"
          hint="0.01 – 0.99"
          suffix="USDC"
          value={priceStr}
          onChange={setPriceStr}
          invalid={priceStr !== "" && !priceOk}
        />
      )}

      <Field
        label="Size"
        hint="shares"
        suffix={outcome}
        value={sizeStr}
        onChange={setSizeStr}
        invalid={sizeStr !== "" && !sizeOk}
      />

      {/* Three-line economics summary. We make the bet concrete:
          - Total: what leaves the wallet now
          - If wins: max payout when this side resolves true
          - Profit: payout minus total (with % return) */}
      <div className="mt-4 space-y-1 rounded-md border border-[var(--line-soft)] bg-[var(--input-bg)] px-3 py-2.5">
        <Line label="Total" value={`$${microsToUsdcString(totalMicros)}`} />
        <Line
          label={`If ${outcome} wins`}
          value={`$${microsToUsdcString(maxPayoutMicros)}`}
        />
        <Line
          label="Potential profit"
          value={`${profitMicros >= 0 ? "+" : ""}$${microsToUsdcString(profitMicros)}`}
          subValue={totalMicros > 0 ? `${profitMicros >= 0 ? "+" : ""}${profitPct.toFixed(0)}%` : undefined}
          accent={profitMicros >= 0 ? "green" : "red"}
        />
      </div>

      <button
        type="button"
        onClick={hasWallet ? handleSubmit : () => wallet.openAuthFlow?.()}
        disabled={hasWallet && !canSubmit}
        className={cn(
          "mt-4 flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors",
          hasWallet
            ? canSubmit
              ? outcome === "YES"
                ? "bg-[var(--green-text)] text-[var(--canvas)] hover:opacity-90"
                : "bg-[var(--red-text)] text-[var(--canvas)] hover:opacity-90"
              : "cursor-not-allowed bg-[var(--line-soft)] text-[var(--muted)]"
            : "bg-[var(--ink)] text-[var(--canvas)] hover:opacity-90"
        )}
      >
        {!hasWallet ? (
          <>
            <Wallet className="h-3.5 w-3.5" />
            Connect to trade
          </>
        ) : submit.kind === "signing" ? (
          "Sign in wallet…"
        ) : submit.kind === "posting" ? (
          "Posting order…"
        ) : submit.kind === "approving" ? (
          "Checking approvals…"
        ) : submit.kind === "filling" ? (
          "Filling on-chain…"
        ) : submit.kind === "indexing" ? (
          "Indexing fill…"
        ) : orderType === "MARKET" ? (
          `Buy ${outcome} at market`
        ) : (
          `Buy ${outcome}`
        )}
      </button>

      {orderType === "MARKET" && sizeOk && !marketHasLiquidity && (
        <p className="mt-3 rounded-md border border-[var(--yellow-text)]/40 bg-[var(--yellow-text)]/5 px-2 py-1.5 text-[11px] text-[var(--yellow-text)]">
          No matching asks on {outcome} at the current slippage. Place a
          limit order or wait for liquidity.
        </p>
      )}
      {submit.kind === "ok" && (
        <p className="mt-3 break-all font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--green-text)]">
          Order posted · {submit.orderHash.slice(0, 10)}…
        </p>
      )}
      {submit.kind === "filled" && (
        <p className="mt-3 break-all font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--green-text)]">
          Filled · {microsToUsdcString(submit.sizeMicros)} {outcome} for $
          {microsToUsdcString(submit.totalMicros)} · {submit.txHash.slice(0, 10)}…
        </p>
      )}
      {submit.kind === "error" && (
        <p className="mt-3 rounded-md border border-[var(--red-text)]/40 bg-[var(--red-text)]/5 px-2 py-1.5 text-[11px] text-[var(--red-text)]">
          {submit.message}
        </p>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
        Orders are signed off-chain (EIP-712) and matched on Arc Testnet.
        Hold winning shares until the market resolves, then claim 1 USDC
        per share. To exit early, sell from your{" "}
        <a
          href="/markets/positions"
          className="text-[var(--ink)] underline-offset-2 hover:underline"
        >
          positions
        </a>{" "}
        page.
      </p>
    </div>
  );
}

// ---------- subcomponents ----------

function OutcomeButton({
  label,
  priceLabel,
  tone,
  active,
  onClick
}: {
  label: string;
  priceLabel: string;
  tone: "green" | "red";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-md border px-3 py-3 transition-colors",
        active
          ? tone === "green"
            ? "border-[var(--green-text)] bg-[var(--green-text)]/10 text-[var(--green-text)]"
            : "border-[var(--red-text)] bg-[var(--red-text)]/10 text-[var(--red-text)]"
          : "border-[var(--line)] text-[var(--ink)] hover:border-[var(--ink)]"
      )}
    >
      <span className="font-mono text-[12px] font-medium uppercase tracking-[0.18em]">
        {label}
      </span>
      <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--muted)]">
        {priceLabel}
      </span>
    </button>
  );
}

function OrderTypeTab({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
        active ? "bg-[var(--ink)] text-[var(--canvas)]" : "text-[var(--muted)] hover:text-[var(--ink)]"
      )}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  hint,
  suffix,
  value,
  onChange,
  invalid
}: {
  label: string;
  hint?: string;
  suffix?: string;
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-baseline justify-between">
        <label className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
          {label}
        </label>
        {hint && (
          <span className="font-mono text-[10px] text-[var(--muted-soft)]">{hint}</span>
        )}
      </div>
      <div
        className={cn(
          "flex items-center rounded-md border bg-[var(--paper)] px-3 py-2",
          invalid ? "border-[var(--red-text)]" : "border-[var(--line)] focus-within:border-[var(--ink)]"
        )}
      >
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-transparent text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
          placeholder="0.00"
        />
        {suffix && (
          <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  subValue,
  accent
}: {
  label: string;
  value: string;
  subValue?: string;
  accent?: "green" | "red";
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-[13px] font-medium",
          accent === "green" && "text-[var(--green-text)]",
          accent === "red" && "text-[var(--red-text)]",
          !accent && "text-[var(--ink)]"
        )}
      >
        {value}
        {subValue && (
          <span className="ml-1.5 text-[10px] opacity-80">{subValue}</span>
        )}
      </span>
    </div>
  );
}

// ---------- helpers ----------

function priceForOutcome(market: Market, outcome: Outcome): string {
  const micros = outcome === "YES" ? market.yesPriceMicros : market.noPriceMicros;
  return (micros / 1_000_000).toString();
}

function formatPriceLabel(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

function parseUsdToMicros(str: string): number | undefined {
  if (!str.trim()) return undefined;
  const n = Number(str);
  if (!Number.isFinite(n) || n < 0) return undefined;
  const micros = Math.round(n * Number(PRICE_SCALE));
  return Number.isSafeInteger(micros) ? micros : undefined;
}
