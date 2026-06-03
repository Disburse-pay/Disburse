import { createContext, useContext } from "react";
import type { ReceiptData } from "./types";

export const ReceiptContext = createContext<ReceiptData | null>(null);

export function useReceipt(): ReceiptData {
  const ctx = useContext(ReceiptContext);
  if (!ctx) {
    throw new Error(
      "Receipt section components must be used inside <Receipt data={...}>",
    );
  }
  return ctx;
}
