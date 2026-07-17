import { useEffect, useState } from "react";
import { isAddress, type Address } from "viem";
import { useI18n } from "../lib/i18n";
import { handleFromInput, looksLikeHandleInput, lookupIdByAddress, resolveIdByHandle, type DisburseId } from "../lib/idsApi";
import { shortAddress } from "../lib/payments";

type Props = {
  value: string;
  onApply: (address: Address) => void;
};

type LookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; id: DisburseId }
  | { kind: "missing"; handle: string }
  | { kind: "known"; id: DisburseId };

/**
 * Companion row for recipient inputs. When the user types a Disburse ID
 * (with or without @), it resolves the name and offers the wallet address;
 * when they paste an address that owns a name, it confirms who that is.
 */
export default function HandleHint({ value, onApply }: Props) {
  const { t } = useI18n();
  const [state, setState] = useState<LookupState>({ kind: "idle" });

  useEffect(() => {
    const trimmed = value.trim();
    const isHandle = looksLikeHandleInput(trimmed);
    const isKnownAddressCandidate = isAddress(trimmed);
    if (!isHandle && !isKnownAddressCandidate) {
      setState({ kind: "idle" });
      return;
    }

    let isActive = true;
    setState({ kind: "loading" });
    const timer = window.setTimeout(() => {
      const lookup = isHandle
        ? resolveIdByHandle(trimmed).then<LookupState>((id) =>
            id ? { kind: "found", id } : { kind: "missing", handle: handleFromInput(trimmed) }
          )
        : lookupIdByAddress(trimmed as Address).then<LookupState>((id) =>
            id ? { kind: "known", id } : { kind: "idle" }
          );
      lookup
        .then((next) => {
          if (isActive) {
            setState(next);
          }
        })
        .catch(() => {
          if (isActive) {
            setState({ kind: "idle" });
          }
        });
    }, 350);

    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [value]);

  if (state.kind === "idle") {
    return null;
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
      {state.kind === "loading" && <span>{t("loading")}</span>}
      {state.kind === "found" && (
        <>
          <span>
            @{state.id.handle} · {shortAddress(state.id.address)}
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() => onApply(state.id.address)}
          >
            {t("disburseIdUse")}
          </button>
        </>
      )}
      {state.kind === "missing" && <span>{t("disburseIdNotFound", { handle: state.handle })}</span>}
      {state.kind === "known" && <span>{t("disburseIdKnownAs", { handle: state.id.handle })}</span>}
    </div>
  );
}
