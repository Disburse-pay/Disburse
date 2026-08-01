import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AtSign, BellOff, Inbox as InboxIcon, X } from "lucide-react";
import type { Address } from "viem";
import { useI18n } from "../lib/i18n";
import {
  clearInboxAuth,
  fetchInbox,
  ignoreInboxNotification,
  markInboxRead,
  readCachedInboxAuth,
  requestInboxAuth,
  type InboxAuth,
  type InboxNotification,
  type InboxPayload
} from "../lib/notificationsApi";
import type { EthereumProvider } from "../lib/onchain";
import { encodeRequestPayload, shortAddress } from "../lib/payments";

const UNREAD_POLL_MS = 30_000;

/**
 * Poll the unread notification count for the header badge. Only polls when
 * the wallet holds a cached inbox-access credential — it never prompts for a
 * signature on its own.
 */
export function useInboxUnread(account: Address | undefined, refreshKey = 0): number {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    setUnread(0);
    if (!account) {
      return;
    }
    let isActive = true;

    const poll = async () => {
      const auth = readCachedInboxAuth(account);
      if (!auth) {
        return;
      }
      try {
        const payload = await fetchInbox(auth);
        if (isActive && payload) {
          setUnread(payload.unreadCount);
        }
      } catch {
        // Expired credential or network hiccup; the badge just stays put.
      }
    };

    void poll();
    const interval = window.setInterval(poll, UNREAD_POLL_MS);
    return () => {
      isActive = false;
      window.clearInterval(interval);
    };
  }, [account, refreshKey]);

  return unread;
}

type Props = {
  open: boolean;
  onClose: () => void;
  account?: Address;
  getProvider: () => Promise<EthereumProvider | undefined>;
  onNavigate: (target: string) => void;
  /** Called after the inbox changes unread state so the badge can refresh. */
  onActivity: () => void;
};

/**
 * The notification inbox. Notifications are addressed to the wallet's
 * Disburse ID; payment requests offer Pay now (opens the locked pay flow)
 * and Ignore.
 */
export default function InboxPanel({ open, onClose, account, getProvider, onNavigate, onActivity }: Props) {
  const { t } = useI18n();
  const [auth, setAuth] = useState<InboxAuth | undefined>();
  const [payload, setPayload] = useState<InboxPayload | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const loadedWalletRef = useRef<string | undefined>(undefined);
  const activeAccountRef = useRef<Address | undefined>(account);
  activeAccountRef.current = account;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const currentAuth =
    auth && account && auth.wallet.toLowerCase() === account.toLowerCase()
      ? auth
      : undefined;
  const visiblePayload = currentAuth ? payload : undefined;

  // Anchor the popover under the header bell (its wrapper carries
  // data-inbox-anchor). Align the card's right edge to the bell's right edge
  // and drop it just below, like a typical notifications menu.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = document.querySelector<HTMLElement>("[data-inbox-anchor]");
      if (!trigger) {
        setAnchor({ top: 60, right: 16 });
        return;
      }
      const box = trigger.getBoundingClientRect();
      setAnchor({ top: box.bottom + 8, right: Math.max(8, window.innerWidth - box.right) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Close on Esc and outside click.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (cardRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.("[data-inbox-anchor]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, onClose]);

  const loadInbox = useCallback(
    async (nextAuth: InboxAuth) => {
      const walletKey = nextAuth.wallet.toLowerCase();
      setIsLoading(true);
      setError(undefined);
      try {
        // Opening the inbox reads it: everything unread flips to read.
        const next = await markInboxRead(nextAuth);
        if (activeAccountRef.current?.toLowerCase() !== walletKey) return;
        setPayload(next);
        onActivity();
      } catch (loadError) {
        if (activeAccountRef.current?.toLowerCase() !== walletKey) return;
        setAuth(undefined);
        setPayload(undefined);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (activeAccountRef.current?.toLowerCase() === walletKey) {
          setIsLoading(false);
        }
      }
    },
    [onActivity]
  );

  useEffect(() => {
    if (!open) {
      loadedWalletRef.current = undefined;
      return;
    }
    if (!account) {
      loadedWalletRef.current = undefined;
      setAuth(undefined);
      setPayload(undefined);
      setIsLoading(false);
      setError(undefined);
      return;
    }
    const walletKey = account.toLowerCase();
    if (loadedWalletRef.current === walletKey) {
      return;
    }
    loadedWalletRef.current = walletKey;
    const cached = readCachedInboxAuth(account);
    setAuth(cached);
    setPayload(undefined);
    setError(undefined);
    if (cached) {
      void loadInbox(cached);
    }
  }, [open, account, loadInbox]);

  async function handleUnlock() {
    if (!account || isUnlocking) {
      return;
    }
    setError(undefined);
    const provider = await getProvider();
    if (!provider) {
      setError(t("noWalletPage"));
      return;
    }
    setIsUnlocking(true);
    try {
      const nextAuth = await requestInboxAuth(provider, account);
      setAuth(nextAuth);
      await loadInbox(nextAuth);
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : String(unlockError));
    } finally {
      setIsUnlocking(false);
    }
  }

  async function handleIgnore(id: string) {
    if (!currentAuth) {
      return;
    }
    try {
      const next = await ignoreInboxNotification(currentAuth, id);
      if (activeAccountRef.current?.toLowerCase() !== currentAuth.wallet.toLowerCase()) return;
      setPayload(next);
      onActivity();
    } catch (ignoreError) {
      if (account) {
        clearInboxAuth(account);
      }
      setError(ignoreError instanceof Error ? ignoreError.message : String(ignoreError));
    }
  }

  function handlePayNow(notification: InboxNotification) {
    const request = notification.payload.request;
    if (!request) {
      return;
    }
    if (!request.requestToken) {
      setError("This notification uses an older payment link. Ask the requester for a fresh verified QR request.");
      return;
    }
    onClose();
    onNavigate(`/pay?r=${encodeRequestPayload(request)}`);
  }

  const transition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.16, ease: [0.16, 1, 0.3, 1] as const };

  return createPortal(
    <AnimatePresence>
      {open && anchor && (
        <motion.div
          ref={cardRef}
          role="dialog"
          aria-modal="false"
          aria-label={t("inbox")}
          initial={{ opacity: 0, scale: 0.94, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: -6 }}
          transition={transition}
          style={{
            position: "fixed",
            top: anchor.top,
            right: anchor.right,
            transformOrigin: "top right",
            width: "min(92vw, 380px)",
            maxHeight: "min(70vh, 560px)"
          }}
          className="z-[60] flex flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper)] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.55)]"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-[var(--line-soft)] px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-md font-semibold tracking-tight text-[var(--ink)]">{t("inbox")}</h2>
              {visiblePayload?.handle && (
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">@{visiblePayload.handle}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 -mt-0.5 rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--line-soft)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
            >
              <X size={15} strokeWidth={1.75} />
            </button>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {!account && <p className="text-sm text-[var(--muted)]">{t("disburseIdConnect")}</p>}

            {account && !currentAuth && (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-[var(--muted)]">{t("inboxUnlockHint")}</p>
                <button
                  type="button"
                  onClick={() => void handleUnlock()}
                  disabled={isUnlocking}
                  className="inline-flex h-8 items-center rounded-md bg-[var(--primary-bg)] px-3 text-base font-medium text-[color:var(--primary-text)] transition-colors hover:bg-[var(--primary-bg-hover)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                >
                  {isUnlocking ? t("inboxSigning") : t("inboxUnlock")}
                </button>
              </div>
            )}

            {account && currentAuth && isLoading && <p className="text-sm text-[var(--muted)]">{t("loading")}</p>}

            {account && currentAuth && !isLoading && visiblePayload && visiblePayload.handle === null && (
              <p className="text-sm text-[var(--muted)]">{t("inboxNoName")}</p>
            )}

            {account && currentAuth && !isLoading && visiblePayload && visiblePayload.handle !== null && visiblePayload.notifications.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <InboxIcon size={20} strokeWidth={1.5} className="text-[var(--muted)]" />
                <p className="text-sm text-[var(--muted)]">{t("inboxEmpty")}</p>
              </div>
            )}

            {account && currentAuth && !isLoading && visiblePayload && visiblePayload.notifications.length > 0 && (
              <ul className="flex flex-col gap-2.5">
                {visiblePayload.notifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onPayNow={() => handlePayNow(notification)}
                    onIgnore={() => void handleIgnore(notification.id)}
                  />
                ))}
              </ul>
            )}

            {error && (
              <p role="alert" className="mt-4 text-sm text-[var(--ink)]">
                {error}
              </p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function NotificationItem({
  notification,
  onPayNow,
  onIgnore
}: {
  notification: InboxNotification;
  onPayNow: () => void;
  onIgnore: () => void;
}) {
  const { t } = useI18n();
  const { payload } = notification;
  const isIgnored = notification.status === "ignored";
  const createdAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(notification.createdAt)
  );

  if (notification.kind === "payment_request") {
    const request = payload.request;
    const canPay = Boolean(request?.requestToken);
    const title = payload.fromHandle
      ? t("inboxRequestFrom", { from: payload.fromHandle, amount: request?.amount ?? "", token: request?.token ?? "" })
      : t("inboxRequestAnon", { amount: request?.amount ?? "", token: request?.token ?? "" });
    return (
      <li
        className={`rounded-md border border-[var(--line)] bg-[var(--paper)] p-3 ${isIgnored ? "opacity-55" : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-base font-medium text-[var(--ink)]">
              <AtSign size={13} strokeWidth={2} className="shrink-0 text-[var(--muted)]" />
              <span className="truncate">{title}</span>
            </p>
            {request?.label && <p className="mt-0.5 truncate text-sm text-[var(--muted)]">{request.label}</p>}
            <p className="mt-1 text-xs text-[var(--muted)]">{createdAt}</p>
          </div>
        </div>
        {!isIgnored && request && (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onPayNow}
              disabled={!canPay}
              title={canPay ? undefined : "Ask the requester for a fresh verified QR request."}
              className="inline-flex h-7 items-center rounded-md bg-[var(--primary-bg)] px-3 text-sm font-medium text-[color:var(--primary-text)] transition-colors hover:bg-[var(--primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
            >
              {t("payNow")}
            </button>
            <button
              type="button"
              onClick={onIgnore}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--line-strong)] bg-[var(--paper)] px-3 text-sm text-[var(--ink)] transition-colors hover:border-[var(--ink-soft)] hover:bg-[var(--paper-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
            >
              <BellOff size={12} strokeWidth={1.75} />
              {t("ignore")}
            </button>
          </div>
        )}
        {isIgnored && <p className="mt-2 text-xs text-[var(--muted)]">{t("inboxIgnored")}</p>}
      </li>
    );
  }

  return (
    <li className="rounded-md border border-[var(--line)] bg-[var(--paper)] p-3">
      <p className="text-base font-medium text-[var(--ink)]">
        {t("inboxReceived", {
          label: payload.label ?? "",
          amount: payload.amount ?? "",
          token: payload.token ?? ""
        })}
      </p>
      {payload.payer && (
        <p className="mt-0.5 text-sm text-[var(--muted)]">{shortAddress(payload.payer)}</p>
      )}
      <p className="mt-1 text-xs text-[var(--muted)]">{createdAt}</p>
    </li>
  );
}
