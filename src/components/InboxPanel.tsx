import { useCallback, useEffect, useRef, useState } from "react";
import { AtSign, BellOff, Inbox as InboxIcon } from "lucide-react";
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
import SidePanel from "./ui/SidePanel";

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
  const hasLoadedRef = useRef(false);

  const loadInbox = useCallback(
    async (nextAuth: InboxAuth) => {
      setIsLoading(true);
      setError(undefined);
      try {
        // Opening the inbox reads it: everything unread flips to read.
        const next = await markInboxRead(nextAuth);
        setPayload(next);
        onActivity();
      } catch (loadError) {
        setAuth(undefined);
        setPayload(undefined);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        setIsLoading(false);
      }
    },
    [onActivity]
  );

  useEffect(() => {
    if (!open) {
      hasLoadedRef.current = false;
      return;
    }
    if (!account || hasLoadedRef.current) {
      return;
    }
    hasLoadedRef.current = true;
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
    if (!auth) {
      return;
    }
    try {
      const next = await ignoreInboxNotification(auth, id);
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
    onClose();
    onNavigate(`/pay?r=${encodeRequestPayload(request)}`);
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      side="right"
      width={400}
      scrim={false}
      ariaLabel={t("inbox")}
      title={t("inbox")}
      description={payload?.handle ? `@${payload.handle}` : undefined}
    >
      {!account && <p className="text-sm text-[var(--muted)]">{t("disburseIdConnect")}</p>}

      {account && !auth && (
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

      {account && auth && isLoading && <p className="text-sm text-[var(--muted)]">{t("loading")}</p>}

      {account && auth && !isLoading && payload && payload.handle === null && (
        <p className="text-sm text-[var(--muted)]">{t("inboxNoName")}</p>
      )}

      {account && auth && !isLoading && payload && payload.handle !== null && payload.notifications.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <InboxIcon size={20} strokeWidth={1.5} className="text-[var(--muted)]" />
          <p className="text-sm text-[var(--muted)]">{t("inboxEmpty")}</p>
        </div>
      )}

      {account && auth && !isLoading && payload && payload.notifications.length > 0 && (
        <ul className="flex flex-col gap-3">
          {payload.notifications.map((notification) => (
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
    </SidePanel>
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
              className="inline-flex h-7 items-center rounded-md bg-[var(--primary-bg)] px-3 text-sm font-medium text-[color:var(--primary-text)] transition-colors hover:bg-[var(--primary-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
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
