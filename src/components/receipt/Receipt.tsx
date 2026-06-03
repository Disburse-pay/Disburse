import type { ReactNode } from "react";
import { Card } from "../ui";
import { ReceiptContext } from "./context";
import type { ReceiptData } from "./types";

type ReceiptProps = {
  data: ReceiptData;
  children: ReactNode;
  className?: string;
};

/**
 * Unified Receipt surface. One Card; child sections render as divided
 * regions inside it, never nested cards. Use with the compound API:
 *
 *   <Receipt data={data}>
 *     <Receipt.Summary />
 *     <Receipt.Timeline />
 *     <Receipt.Proof />
 *   </Receipt>
 *
 * Every field (amount, label, tx hash, parties, network, status) is
 * rendered exactly once across the three sections.
 */
export default function Receipt({ data, children, className }: ReceiptProps) {
  return (
    <ReceiptContext.Provider value={data}>
      <Card
        padding="none"
        aria-label="Settlement receipt"
        className={className}
      >
        <div className="divide-y divide-[var(--line-soft)]">{children}</div>
      </Card>
    </ReceiptContext.Provider>
  );
}
