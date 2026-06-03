import Receipt from "./Receipt";
import ReceiptSummary from "./ReceiptSummary";
import ReceiptTimeline from "./ReceiptTimeline";
import ReceiptProof from "./ReceiptProof";

type CompoundReceipt = typeof Receipt & {
  Summary: typeof ReceiptSummary;
  Timeline: typeof ReceiptTimeline;
  Proof: typeof ReceiptProof;
};

const Compound = Receipt as CompoundReceipt;
Compound.Summary = ReceiptSummary;
Compound.Timeline = ReceiptTimeline;
Compound.Proof = ReceiptProof;

export default Compound;
export type { ReceiptData, ReceiptAttestation, ReceiptCallbacks } from "./types";
