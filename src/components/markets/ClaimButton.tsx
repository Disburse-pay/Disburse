import { useState } from "react";
import { Check, FileCheck2, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

type Props = {
  claimable: boolean;
  pspUid?: string;
  payoutLabel: string;
  onClaim?: () => Promise<void> | void;
};

export default function ClaimButton({ claimable, pspUid, payoutLabel, onClaim }: Props) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (!onClaim || !claimable || pending) return;
    setPending(true);
    try {
      await onClaim();
    } finally {
      setPending(false);
    }
  }

  if (pspUid) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--green-text)]/30 bg-[var(--green-text)]/10 px-2.5 py-1 text-[11.5px] font-medium text-[var(--green-text)]">
          <Check className="h-3 w-3" /> Claimed · {payoutLabel}
        </span>
        <a
          href={`/api/psp?uid=${encodeURIComponent(pspUid)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
        >
          <FileCheck2 className="h-3 w-3" /> PSP · {pspUid.slice(4, 12)}…
        </a>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!claimable || pending}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
        claimable
          ? "bg-[var(--ink)] text-[color:var(--canvas)] hover:opacity-90"
          : "cursor-not-allowed bg-[var(--line-soft)] text-[var(--muted)]"
      )}
    >
      {pending && <Loader2 className="h-3 w-3 animate-spin" />}
      {claimable ? `Claim ${payoutLabel}` : "Not eligible"}
    </button>
  );
}
