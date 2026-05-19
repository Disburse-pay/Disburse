import { useEffect, useMemo, useState } from "react";
import { Wallet, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { useDisburseDynamicWallet } from "../../lib/dynamic";
import {
  microsToUsdcString,
  type Market,
  type OrderSide,
  type Outcome,
  type Position
} from "../../lib/markets/types";
import {
  fetchPositions,
  indexFillsTx,
  MarketsApiError,
  postSignedOrder,
  type RawOpenOrder,
  type WireOrder
} from "../../lib/markets/api";
import { getMarketsConfig } from "../../lib/markets/config";
import { PRICE_SCALE, randomSalt, signOrder, type ClientOrder } from "../../lib/markets/sign";
import { planTakerFills, takeOrder } from "../../lib/markets/onchain";

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

type Intent = "BUY" | "SELL";
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

export default function TradePanel({ market, outcome, onOutcomeChange, rawOrders }: Props) {
  const [intent, setIntent] = useState<Intent>("BUY");
  // Default to MARKET — that's the "click to actually trade shares" path.
  // Limit is the maker path for users who want to set their own price.
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [priceStr, setPriceStr] = useState<string>(() =>
    priceForOutcome(market, outcome)
  );
  const [sizeStr, setSizeStr] = useState<string>("10");
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });
  const [position, setPosition] = useState<Position | undefined>();

  const wallet = useDisburseDynamicWallet();
  const account = wallet.getAccount?.();
  const hasWallet = Boolean(account);

  // Load this market's position whenever the wallet changes. Used to gate
  // the Sell flow — you can't sell shares you don't own.
  useEffect(() => {
    if (!account) {
      setPosition(undefined);
      return;
    }
    let cancelled = false;
    fetchPositions(account)
      .then((rows) => {
        if (cancelled) return;
        setPosition(rows.find((p) => p.marketId === market.id));
      })
      .catch(() => {
        // Position read is best-effort; failures just mean the Sell section
        // stays hidden until next reload. We don't surface this as an error
        // because it would compete with the trade panel's primary status line.
      });
    return () => {
      cancelled = true;
    };
  }, [account, market.id, submit.kind]);

  const yesShares = position?.yesSharesMicros ?? 0;
  const noShares = position?.noSharesMicros ?? 0;
  const sharesOwnedForOutcome = outcome === "YES" ? yesShares : noShares;
  const canSell = sharesOwnedForOutcome > 0;

  // If the user is in Sell mode and switches to an outcome they don't own,
  // drop back to Buy — otherwise the Sell button would submit a sell with
  // size > position, which the matching engine rejects anyway.
  useEffect(() => {
    if (intent === "SELL" && !canSell) setIntent("BUY");
  }, [intent, canSell]);

  const priceMicros = useMemo(() => parseUsdToMicros(priceStr), [priceStr]);
  const sizeMicros = useMemo(() => parseUsdToMicros(sizeStr), [sizeStr]);

  const priceOk = priceMicros !== undefined && priceMicros > 0 && priceMicros < 1_000_000;
  const sizeOk = sizeMicros !== undefined && sizeMicros > 0;
  // For sell, also enforce size <= shares owned.
  const sellSizeOk = intent === "BUY" || (sizeMicros !== undefined && sizeMicros <= sharesOwnedForOutcome);

  // For Market mode the "estimated total" is the size walked against the
  // current book at the best opposite-side prices. We compute it here so the
  // Total row stays in sync with the actual on-chain sweep.
  const marketPlan = useMemo(() => {
    if (orderType !== "MARKET" || !sizeOk || !account) return undefined;
    const limit =
      intent === "BUY"
        ? (PRICE_SCALE * (10_000n + MARKET_SLIPPAGE_BPS)) / 10_000n
        : (PRICE_SCALE * (10_000n - MARKET_SLIPPAGE_BPS)) / 10_000n;
    // Clamp limit price into the valid (0, 1_000_000) range expected by the
    // Exchange. For BUY the slippage-adjusted ceiling could exceed 1.0 — cap
    // at PRICE_SCALE-1 so we'll still sweep any ask in-range.
    const clamped = limit >= PRICE_SCALE ? PRICE_SCALE - 1n : limit <= 0n ? 1n : limit;
    return planTakerFills({
      rawOrders,
      takerAddress: account,
      outcome,
      intent,
      sizeMicros: BigInt(sizeMicros!),
      limitPriceMicros: clamped
    });
  }, [orderType, sizeOk, sizeMicros, account, rawOrders, outcome, intent]);

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

  const submitting =
    submit.kind === "signing" ||
    submit.kind === "posting" ||
    submit.kind === "approving" ||
    submit.kind === "filling" ||
    submit.kind === "indexing";

  const canSubmit =
    orderType === "LIMIT"
      ? priceOk && sizeOk && sellSizeOk && hasWallet && !submitting
      : sizeOk && sellSizeOk && hasWallet && marketHasLiquidity && !submitting;

  async function handleSubmit() {
    if (!canSubmit || !account) return;

    if (orderType === "MARKET") {
      await handleMarketSubmit();
      return;
    }

    setSubmit({ kind: "signing" });

    try {
      const { exchangeAddress } = getMarketsConfig();
      const provider = await wallet.getEthereumProvider();
      if (!provider) {
        throw new Error("Wallet provider not available. Reconnect and try again.");
      }

      const side: OrderSide = intent;
      const order: ClientOrder = {
        maker: account,
        market: market.onchainAddress,
        outcome: outcome === "YES" ? 1 : 0,
        side: side === "BUY" ? 0 : 1,
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
            ? `Signing failed: ${err.message}`
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

      // Slippage-adjusted limit. Same math as `marketPlan` above; recompute
      // here so we don't depend on a stale memo when the user clicks fast.
      const limit =
        intent === "BUY"
          ? (PRICE_SCALE * (10_000n + MARKET_SLIPPAGE_BPS)) / 10_000n
          : (PRICE_SCALE * (10_000n - MARKET_SLIPPAGE_BPS)) / 10_000n;
      const clamped = limit >= PRICE_SCALE ? PRICE_SCALE - 1n : limit <= 0n ? 1n : limit;

      setSubmit({ kind: "filling" });
      const result = await takeOrder(provider, {
        taker: account,
        market: market.onchainAddress,
        outcome,
        intent,
        sizeMicros: BigInt(sizeMicros!),
        limitPriceMicros: clamped,
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

  function handleBuy(next: Outcome) {
    setIntent("BUY");
    onOutcomeChange(next);
    setPriceStr(priceForOutcome(market, next));
    setSubmit({ kind: "idle" });
  }

  function handleSell(next: Outcome) {
    setIntent("SELL");
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
          {intent === "BUY" ? "Trade · Buy" : `Trade · Sell ${outcome}`}
        </p>
        {account && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
            {`${account.slice(0, 6)}…${account.slice(-4)}`}
          </span>
        )}
      </div>

      {/* Primary intent: pick a side to buy. Two big buttons replace the old
          BUY/SELL toggle + YES/NO toggle pair. Selling is reached via the
          Position section below. */}
      {intent === "BUY" ? (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <OutcomeButton
            label="Buy YES"
            priceLabel={yesPriceLabel}
            tone="green"
            active={outcome === "YES"}
            onClick={() => handleBuy("YES")}
          />
          <OutcomeButton
            label="Buy NO"
            priceLabel={noPriceLabel}
            tone="red"
            active={outcome === "NO"}
            onClick={() => handleBuy("NO")}
          />
        </div>
      ) : (
        <div className="mb-4 flex items-center justify-between rounded-md border border-[var(--line)] bg-[var(--input-bg)] px-3 py-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--ink)]">
            Selling {outcome}
          </span>
          <button
            type="button"
            onClick={() => handleBuy(outcome)}
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)] hover:text-[var(--ink)]"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>
        </div>
      )}

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
        hint={intent === "SELL" ? `max ${microsToUsdcString(sharesOwnedForOutcome)}` : "shares"}
        suffix={outcome}
        value={sizeStr}
        onChange={setSizeStr}
        invalid={sizeStr !== "" && (!sizeOk || !sellSizeOk)}
      />

      <div className="mt-4 flex items-center justify-between rounded-md border border-[var(--line-soft)] bg-[var(--input-bg)] px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
          Total
        </span>
        <span className="font-mono text-[13px] font-medium text-[var(--ink)]">
          ${microsToUsdcString(totalMicros)}
        </span>
      </div>

      <button
        type="button"
        onClick={hasWallet ? handleSubmit : () => wallet.openAuthFlow?.()}
        disabled={hasWallet && !canSubmit}
        className={cn(
          "mt-4 flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors",
          hasWallet
            ? canSubmit
              ? intent === "BUY"
                ? outcome === "YES"
                  ? "bg-[var(--green-text)] text-[var(--canvas)] hover:opacity-90"
                  : "bg-[var(--red-text)] text-[var(--canvas)] hover:opacity-90"
                : "bg-[var(--ink)] text-[var(--canvas)] hover:opacity-90"
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
          intent === "BUY" ? `Buy ${outcome} at market` : `Sell ${outcome} at market`
        ) : intent === "BUY" ? (
          `Buy ${outcome}`
        ) : (
          `Sell ${outcome}`
        )}
      </button>

      {orderType === "MARKET" && sizeOk && !marketHasLiquidity && (
        <p className="mt-3 rounded-md border border-[var(--yellow-text)]/40 bg-[var(--yellow-text)]/5 px-2 py-1.5 text-[11px] text-[var(--yellow-text)]">
          No matching {intent === "BUY" ? "asks" : "bids"} on {outcome} at the current
          slippage. Place a limit order or wait for liquidity.
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

      {/* Position section: only renders when the user holds shares in this
          market. Each line lets the user switch the panel to Sell mode for
          that outcome. */}
      {hasWallet && (yesShares > 0 || noShares > 0) && (
        <section className="mt-5 rounded-md border border-[var(--line-soft)] bg-[var(--input-bg)] p-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
            Your position
          </p>
          {yesShares > 0 && (
            <PositionRow
              outcome="YES"
              sharesMicros={yesShares}
              active={intent === "SELL" && outcome === "YES"}
              onSell={() => handleSell("YES")}
            />
          )}
          {noShares > 0 && (
            <PositionRow
              outcome="NO"
              sharesMicros={noShares}
              active={intent === "SELL" && outcome === "NO"}
              onSell={() => handleSell("NO")}
            />
          )}
        </section>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
        Orders are signed off-chain (EIP-712) and matched on Arc Testnet.
        Before your first trade, approve USDC and outcome shares to the Exchange.
        Winning payouts emit a PSP.
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

function PositionRow({
  outcome,
  sharesMicros,
  active,
  onSell
}: {
  outcome: Outcome;
  sharesMicros: number;
  active: boolean;
  onSell: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "rounded-sm px-1.5 py-[2px] font-mono text-[9px] tracking-[0.18em]",
            outcome === "YES"
              ? "bg-[var(--green-text)]/15 text-[var(--green-text)]"
              : "bg-[var(--red-text)]/15 text-[var(--red-text)]"
          )}
        >
          {outcome}
        </span>
        <span className="font-mono text-[12px] text-[var(--ink)]">
          {microsToUsdcString(sharesMicros)} shares
        </span>
      </div>
      <button
        type="button"
        onClick={onSell}
        disabled={active}
        className={cn(
          "rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors",
          active
            ? "border-[var(--line)] text-[var(--muted)]"
            : "border-[var(--ink)] text-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--canvas)]"
        )}
      >
        {active ? "Selected" : "Sell"}
      </button>
    </div>
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
