import { QrCode, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { useI18n } from "@/src/lib/i18n";

interface BalanceCardProps {
  totalVolume: string;
  verifiedVolume: string;
  pendingVolume: string;
  requestCount: number;
  receiptCount: number;
  account?: string;
  onNavigate: (target: string) => void;
}

export default function BalanceCard({ totalVolume, verifiedVolume, pendingVolume, requestCount, receiptCount, account, onNavigate }: BalanceCardProps) {
  const [showQR, setShowQR] = useState(false);
  const { t, currency, formatCurrency } = useI18n();

  return (
    <>
      <div className="border border-brand-border bg-brand-dark p-6 hover:border-[#222] transition-all duration-300 hover:-translate-y-0.5">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <p className="text-xs font-mono uppercase tracking-widest text-muted mb-2">
              {t("totalVolume")} · {currency}
            </p>
            <h3 className="text-4xl md:text-5xl font-medium tracking-tighter text-white tabular-nums">
              {formatCurrency(totalVolume)}
            </h3>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate("/qr-payments")}
              className="px-5 py-2 border border-brand-border text-white text-xs font-medium uppercase tracking-widest flex items-center gap-2 hover:bg-brand-surface active:scale-[0.98] active:bg-brand-surface transition-all"
            >
              <QrCode className="w-4 h-4" />
              {t("payQR")}
            </button>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-brand-border flex flex-wrap gap-6 text-xs font-mono uppercase tracking-wider text-muted">
          <div>
            <span className="text-white font-medium tabular-nums">{formatCurrency(verifiedVolume)}</span> {t("verified")}
          </div>
          <div>
            <span className="text-white font-medium tabular-nums">{formatCurrency(pendingVolume)}</span> {t("pending")}
          </div>
          <div>
            <span className="text-white font-medium tabular-nums">{requestCount}</span> {t("requests")}
          </div>
          <div>
            <span className="text-white font-medium tabular-nums">{receiptCount}</span> {t("receipts")}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showQR && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              onClick={() => setShowQR(false)}
              className="absolute inset-0 bg-black/60"
            />
            <div
              className="relative bg-brand-dark border border-brand-border p-8 max-w-sm w-full z-10"
            >
              <button 
                onClick={() => setShowQR(false)}
                className="absolute top-4 right-4 p-2 rounded-full hover:bg-brand-surface transition-colors"
                aria-label="Close QR Modal"
              >
                <X className="w-5 h-5 text-muted" />
              </button>

              <div className="text-center mb-8 mt-2">
                <h3 className="text-xl font-bold text-white mb-2">Receive Payment</h3>
                <p className="text-sm text-muted">Scan this code to pay with USDC on Arc Testnet</p>
              </div>

              <div className="bg-white p-6 aspect-square flex items-center justify-center mb-6">
                <QrCode className="w-3/4 h-3/4 text-brand-dark" />
              </div>

              <div className="text-center">
                <p className="text-xs text-muted mb-2 uppercase tracking-wider font-mono">Wallet Address</p>
                <p className="text-sm font-mono text-white bg-brand-surface py-3 px-4 break-all border border-brand-border">
                  {account || "Connect wallet to view address"}
                </p>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
