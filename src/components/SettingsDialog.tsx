import { useEffect, useState } from "react";
import { Check, Moon, Sun } from "lucide-react";
import Dialog from "./Dialog";
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
};

/**
 * Settings dialog. Replaces the old /settings page. Grouped into three
 * sections — Appearance, Language, Currency — with plain, readable copy.
 */
export default function SettingsDialog({ open, onClose, theme, onToggleTheme }: Props) {
  const { t, setLang, setCurrency } = useI18n();
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  // Re-sync when the dialog opens in case storage changed elsewhere.
  useEffect(() => {
    if (open) setSettings(loadSettings());
  }, [open]);

  function updateLanguage(lang: LanguageCode) {
    const next: AppSettings = {
      ...settings,
      language: lang,
      // Auto-pair the regional currency, but users can override below.
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

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("settings")}
      description="Preferences are saved locally on this device."
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-[var(--primary-bg)] px-4 py-1.5 text-[13px] font-medium text-[var(--primary-text)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]"
        >
          Done
        </button>
      }
    >
      <div className="space-y-6">
        {/* Appearance */}
        <Section label="Appearance" hint="Choose how the console looks on this device.">
          <div className="grid grid-cols-2 gap-2">
            <ThemeTile
              active={theme === "light"}
              label="Light"
              icon={<Sun size={16} strokeWidth={1.75} />}
              onClick={() => {
                if (theme !== "light") onToggleTheme();
              }}
            />
            <ThemeTile
              active={theme === "dark"}
              label="Dark"
              icon={<Moon size={16} strokeWidth={1.75} />}
              onClick={() => {
                if (theme !== "dark") onToggleTheme();
              }}
            />
          </div>
        </Section>

        {/* Language */}
        <Section label={t("language")} hint="Used for the interface labels in the app.">
          <Select
            value={settings.language}
            onChange={(value) => updateLanguage(value as LanguageCode)}
            options={languages.map(([code, meta]) => ({
              value: code,
              label: `${meta.native} — ${meta.label}`,
            }))}
          />
        </Section>

        {/* Currency */}
        <Section label={t("currency")} hint="Display currency for converted totals. Settlement is always in stablecoin.">
          <Select
            value={settings.currency}
            onChange={(value) => updateCurrency(value as CurrencyCode)}
            options={currencies.map(([code, meta]) => ({
              value: code,
              label: `${code} · ${meta.label} (${meta.symbol})`,
            }))}
          />
        </Section>
      </div>
    </Dialog>
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
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
          {label}
        </h3>
        {hint && (
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
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
        <span
          className={active ? "text-[var(--primary-bg)]" : "text-[var(--muted)]"}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="text-[13px] font-medium text-[var(--ink)]">{label}</span>
      </span>
      {active && (
        <Check size={14} strokeWidth={2} className="text-[var(--primary-bg)]" />
      )}
    </button>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full appearance-none rounded-md border border-[var(--line)] bg-[var(--input-bg)] pl-3 pr-9 text-[13px] text-[var(--ink)] transition-colors hover:border-[var(--line)] focus-visible:border-[var(--focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]/30"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}
