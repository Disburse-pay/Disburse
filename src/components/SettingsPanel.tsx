import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Moon, Sun, X } from "lucide-react";
import Button from "./ui/Button";
import { ARC_CHAIN_ID, arcTestnet } from "../lib/arc";
import { useI18n } from "../lib/i18n";
import {
  type AppSettings,
  type CurrencyCode,
  type LanguageCode,
  CURRENCY_META,
  LANGUAGE_META,
  loadSettings,
  saveSettings,
} from "../lib/settings";

type Theme = "light" | "dark";

type Props = {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  rpcStatusLabel: string;
  rpcBlockLabel: string;
  rpcHealthy?: boolean;
};

const SETTINGS_COPY: Record<
  LanguageCode,
  {
    description: string;
    appearance: string;
    appearanceHint: string;
    light: string;
    dark: string;
    languageHint: string;
    currencyHint: string;
    currencyPreview: string;
    done: string;
  }
> = {
  en: {
    description: "Preferences are saved locally on this device.",
    appearance: "Appearance",
    appearanceHint: "Choose how the console looks on this device.",
    light: "Light",
    dark: "Dark",
    languageHint: "Used for the interface labels in the app.",
    currencyHint: "Display currency for converted totals. Settlement is always in stablecoin.",
    currencyPreview: "Preview",
    done: "Done",
  },
  de: {
    description: "Einstellungen werden lokal auf diesem Gerät gespeichert.",
    appearance: "Darstellung",
    appearanceHint: "Wähle aus, wie die Konsole auf diesem Gerät aussieht.",
    light: "Hell",
    dark: "Dunkel",
    languageHint: "Wird für die Beschriftungen der App-Oberfläche verwendet.",
    currencyHint: "Anzeigewährung für umgerechnete Summen. Die Abwicklung bleibt immer in Stablecoin.",
    currencyPreview: "Vorschau",
    done: "Fertig",
  },
  id: {
    description: "Preferensi disimpan secara lokal di perangkat ini.",
    appearance: "Tampilan",
    appearanceHint: "Pilih tampilan konsol di perangkat ini.",
    light: "Terang",
    dark: "Gelap",
    languageHint: "Dipakai untuk label antarmuka di aplikasi.",
    currencyHint: "Mata uang tampilan untuk total konversi. Settlement tetap dalam stablecoin.",
    currencyPreview: "Pratinjau",
    done: "Selesai",
  },
  ng: {
    description: "Preferences are saved on this device.",
    appearance: "Appearance",
    appearanceHint: "Choose how the console looks on this device.",
    light: "Light",
    dark: "Dark",
    languageHint: "Used for the interface labels in the app.",
    currencyHint: "Display currency for converted totals. Settlement is always in stablecoin.",
    currencyPreview: "Preview",
    done: "Done",
  },
  hi: {
    description: "सेटिंग्स इस डिवाइस पर स्थानीय रूप से सहेजी जाती हैं.",
    appearance: "दिखावट",
    appearanceHint: "चुनें कि इस डिवाइस पर कंसोल कैसा दिखे.",
    light: "लाइट",
    dark: "डार्क",
    languageHint: "ऐप के इंटरफेस लेबल के लिए उपयोग किया जाता है.",
    currencyHint: "बदले गए कुल के लिए प्रदर्शन मुद्रा. सेटलमेंट हमेशा stablecoin में रहता है.",
    currencyPreview: "पूर्वावलोकन",
    done: "हो गया",
  },
  zh: {
    description: "偏好设置会保存在此设备本地.",
    appearance: "外观",
    appearanceHint: "选择此设备上的控制台显示方式.",
    light: "浅色",
    dark: "深色",
    languageHint: "用于应用界面标签.",
    currencyHint: "用于显示换算后的总额. 结算始终使用稳定币.",
    currencyPreview: "预览",
    done: "完成",
  },
};

/**
 * Centered floating settings dialog. Two-column layout so preferences read
 * side by side instead of as one long stack. Closes on Esc or scrim click.
 */
export default function SettingsPanel({
  open,
  onClose,
  theme,
  onToggleTheme,
  rpcStatusLabel,
  rpcBlockLabel,
  rpcHealthy,
}: Props) {
  const { t, setLang, setCurrency, formatCurrency } = useI18n();
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const copy = SETTINGS_COPY[settings.language] ?? SETTINGS_COPY.en;

  useEffect(() => {
    if (open) setSettings(loadSettings());
  }, [open]);

  function updateLanguage(lang: LanguageCode) {
    const next: AppSettings = {
      ...settings,
      language: lang,
      currency: LANGUAGE_META[lang].currency,
    };
    setSettings(next);
    saveSettings(next);
    setLang(lang);
    setCurrency(next.currency);
  }

  function updateCurrency(currency: CurrencyCode) {
    const next: AppSettings = { ...settings, currency };
    setSettings(next);
    saveSettings(next);
    setCurrency(currency);
  }

  const languages = Object.entries(LANGUAGE_META) as [LanguageCode, typeof LANGUAGE_META["en"]][];
  const currencies = Object.entries(CURRENCY_META) as [CurrencyCode, typeof CURRENCY_META["USD"]][];
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/40"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex h-[min(520px,calc(100dvh-32px))] w-[720px] max-w-full flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper)] shadow-[0_24px_64px_-24px_rgba(0,0,0,0.4)]"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-5">
              <div>
                <h2 id={titleId} className="text-lg font-semibold text-[var(--ink)]">
                  {t("settings")}
                </h2>
                <p className="mt-0.5 text-sm text-[var(--muted)]">{copy.description}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={copy.done}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--paper-2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>

            {/* Two columns: preferences left, display + diagnostics right. */}
            <div className="grid flex-1 content-start grid-cols-1 gap-x-10 gap-y-7 overflow-y-auto px-6 py-5 md:grid-cols-2">
              <Section label={copy.appearance} hint={copy.appearanceHint}>
                <div className="grid grid-cols-2 gap-2">
                  <ThemeTile
                    active={theme === "light"}
                    label={copy.light}
                    icon={<Sun size={16} strokeWidth={1.75} />}
                    onClick={() => {
                      if (theme !== "light") onToggleTheme();
                    }}
                  />
                  <ThemeTile
                    active={theme === "dark"}
                    label={copy.dark}
                    icon={<Moon size={16} strokeWidth={1.75} />}
                    onClick={() => {
                      if (theme !== "dark") onToggleTheme();
                    }}
                  />
                </div>
              </Section>

              <Section label={t("language")} hint={copy.languageHint}>
                <AnimatedSelect
                  value={settings.language}
                  onChange={(value) => updateLanguage(value as LanguageCode)}
                  options={languages.map(([code, meta]) => ({
                    value: code,
                    label: `${meta.native} · ${meta.label}`,
                  }))}
                />
              </Section>

              <Section label={t("currency")} hint={copy.currencyHint}>
                <AnimatedSelect
                  value={settings.currency}
                  onChange={(value) => updateCurrency(value as CurrencyCode)}
                  options={currencies.map(([code, meta]) => ({
                    value: code,
                    label: `${meta.label} (${meta.symbol})`,
                  }))}
                />
                <dl className="mt-2 rounded-md bg-[var(--paper-2)] px-3 py-1">
                  <StatusRow label={copy.currencyPreview} value={formatCurrency(1250)} />
                </dl>
              </Section>

              {/* Network diagnostics — reference info you check when something
                  looks wrong; lives here rather than on the Overview page. */}
              <Section label={t("network")} hint={t("liveTelemetry")}>
                <dl className="rounded-md bg-[var(--paper-2)] px-3 py-1">
                  <StatusRow label={t("chain")} value={`${arcTestnet.name} ${ARC_CHAIN_ID}`} />
                  <StatusRow label={t("rpc")} value={rpcStatusLabel} mono />
                  <StatusRow label={t("block")} value={rpcBlockLabel} mono />
                  <StatusRow
                    label={t("status")}
                    value={rpcHealthy ? t("operational") : t("degraded")}
                  />
                </dl>
              </Section>
            </div>

            {/* Footer */}
            <div className="flex justify-end px-6 pb-5 pt-2">
              <Button variant="primary" size="md" onClick={onClose}>
                {copy.done}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function StatusRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className="text-sm text-[var(--muted)]">{label}</dt>
      <dd
        className={[
          "max-w-[60%] truncate text-sm text-[var(--ink)]",
          mono ? "font-mono" : "",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2">
        <h3 className="text-base font-semibold text-[var(--ink)]">
          {label}
        </h3>
        {hint && (
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
            {hint}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function ThemeTile({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "group flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
        active
          ? "border-[var(--primary-bg)] bg-[var(--panel-accent)]"
          : "border-[var(--line)] hover:border-[var(--line)] hover:bg-[var(--line-soft)]",
      ].join(" ")}
    >
      <span className="flex items-center gap-2.5">
        <span className={active ? "text-[var(--primary-bg)]" : "text-[var(--muted)]"} aria-hidden="true">
          {icon}
        </span>
        <span className="text-base font-medium text-[var(--ink)]">{label}</span>
      </span>
      {active && <Check size={14} strokeWidth={2} className="text-[var(--primary-bg)]" />}
    </button>
  );
}

function AnimatedSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  function selectValue(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          }
        }}
        className={[
          "group flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left",
          "bg-[var(--input-bg)] transition-all duration-200 ease-out",
          "hover:border-[var(--primary-bg)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]/35",
          open ? "border-[var(--primary-bg)]" : "border-[var(--line)]",
        ].join(" ")}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-7 min-w-7 items-center justify-center rounded-md border border-[var(--line-soft)] bg-[var(--paper-soft-translucent)] px-2 text-xs font-semibold text-[var(--primary-bg)]">
            {selected.value.toUpperCase()}
          </span>
          <span className="block truncate text-sm font-medium text-[var(--ink)]">{selected.label}</span>
        </span>
        <ChevronDown
          size={15}
          strokeWidth={1.75}
          className={[
            "shrink-0 text-[var(--muted)] transition-transform duration-200 ease-out",
            open ? "rotate-180 text-[var(--primary-bg)]" : "group-hover:text-[var(--ink)]",
          ].join(" ")}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={listboxId}
            role="listbox"
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-52 overflow-y-auto overflow-x-hidden rounded-lg border border-[var(--line)] bg-[var(--paper)] shadow-[0_18px_42px_-26px_rgba(0,0,0,0.55)]"
          >
            <div className="grid gap-1 p-1">
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => selectValue(option.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        setOpen(false);
                      }
                    }}
                    className={[
                      "group relative flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left",
                      "transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]/35",
                      active
                        ? "bg-[var(--panel-accent)] text-[var(--ink)]"
                        : "text-[var(--muted)] hover:bg-[var(--line-soft)] hover:text-[var(--ink)]",
                    ].join(" ")}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        className={[
                          "flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 text-2xs font-semibold transition-colors",
                          active
                            ? "border-[var(--primary-bg)] bg-[var(--paper)] text-[var(--primary-bg)]"
                            : "border-[var(--line-soft)] bg-[var(--input-bg)] text-[var(--muted)] group-hover:text-[var(--ink)]",
                        ].join(" ")}
                      >
                        {option.value.toUpperCase()}
                      </span>
                      <span className="block min-w-0 truncate text-sm font-medium">{option.label}</span>
                    </span>
                    <AnimatePresence initial={false}>
                      {active && (
                        <motion.span
                          initial={{ scale: 0.72, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.72, opacity: 0 }}
                          transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--primary-bg)] text-[color:var(--primary-text)]"
                        >
                          <Check size={12} strokeWidth={2.2} />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
