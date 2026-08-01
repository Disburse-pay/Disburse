import { useEffect, useState } from "react";
import type { EthereumProvider } from "../lib/onchain";
import { refreshDerivedStatus, type PaymentRequest, type Receipt } from "../lib/payments";
import { fetchGatewayBalance } from "../lib/gateway/balance";
import { useI18n } from "../lib/i18n";
import { lazyChart } from "../lib/lazyChart";
import DisburseIdCard from "./DisburseIdCard";
import TransactionsTable from "./TransactionsTable";

const BalanceCard = lazyChart(() => import("./BalanceCard"));
const MonthlyStats = lazyChart(() => import("./MonthlyStats"));

type Props = {
  requests: PaymentRequest[];
  receipts: Receipt[];
  account?: `0x${string}`;
  now: Date;
  onNavigate: (target: string) => void;
  getProvider: () => Promise<EthereumProvider | undefined>;
  onDeposit: () => void;
  balanceRefreshKey: number;
};

export default function DashboardPage({
  requests,
  receipts,
  account,
  now,
  onNavigate,
  getProvider,
  onDeposit,
  balanceRefreshKey
}: Props) {
  const { t } = useI18n();
  const [disburseBalance, setDisburseBalance] = useState<number>();

  useEffect(() => {
    if (!account) {
      setDisburseBalance(undefined);
      return;
    }
    let active = true;
    void fetchGatewayBalance(account)
      .then((balance) => {
        if (active) setDisburseBalance(Number(balance.formatted));
      })
      .catch(() => {
        if (active) setDisburseBalance(undefined);
      });
    return () => {
      active = false;
    };
  }, [account, balanceRefreshKey]);

  const totalVolume = sumAmounts(requests);
  const verifiedVolume = sumAmounts(
    requests.filter((request) => refreshDerivedStatus(request, now).status === "paid")
  );
  const pendingVolume = sumAmounts(
    requests.filter((request) => refreshDerivedStatus(request, now).status === "open")
  );
  const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  const activityData = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (6 - offset));
    const key = date.toISOString().slice(0, 10);
    const dayRequests = requests.filter((request) => request.createdAt.slice(0, 10) === key);
    return {
      name: dayFormatter.format(date),
      volume: sumAmounts(dayRequests),
      count: dayRequests.length
    };
  });
  const trend = activityData.map(({ volume }) => ({ value: volume }));
  const trendDeltaPct = computeTrendDelta(activityData.map(({ volume }) => volume));

  return (
    <div className="ql-dashboard relative z-10 mx-auto flex w-full max-w-[1120px] flex-col pb-6">
      <section className="ql-section">
        <BalanceCard
          totalVolume={totalVolume}
          verifiedVolume={verifiedVolume}
          pendingVolume={pendingVolume}
          requestCount={requests.length}
          receiptCount={receipts.length}
          account={account}
          onNavigate={onNavigate}
          onDeposit={onDeposit}
          disburseBalance={disburseBalance}
          trend={trend}
          trendDeltaPct={trendDeltaPct ?? undefined}
        />
      </section>

      <section className="ql-section mt-4">
        <DisburseIdCard account={account} getProvider={getProvider} />
      </section>

      {requests.length > 0 && (
        <>
          <SectionRule label={t("activity") || "Activity"} />
          <section className="ql-section"><MonthlyStats activityData={activityData} /></section>
        </>
      )}

      <SectionRule label={t("ledger") || "Ledger"} />
      <section className="ql-section">
        <TransactionsTable requests={requests} receipts={receipts} now={now} onNavigate={onNavigate} />
      </section>
    </div>
  );
}

function SectionRule({ label }: { label: string }) {
  return <div className="mb-3 mt-8"><h2 className="text-sm font-medium text-[var(--muted)]">{label}</h2></div>;
}

function sumAmounts(requests: PaymentRequest[]): number {
  return requests.reduce((sum, request) => sum + Number(request.amount || 0), 0);
}

function computeTrendDelta(series: number[]): number | null {
  if (series.length < 4) return null;
  const midpoint = Math.floor(series.length / 2);
  const previous = series.slice(0, midpoint).reduce((sum, value) => sum + value, 0);
  const current = series.slice(midpoint).reduce((sum, value) => sum + value, 0);
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return 100;
  return ((current - previous) / previous) * 100;
}
