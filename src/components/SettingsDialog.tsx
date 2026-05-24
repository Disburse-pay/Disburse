import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Moon, Sun } from "lucide-react";
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
 * Settings dialog. Replaces the old /settings page. Grouped into three
 * sections. Appearance, Language, Currency. with plain, readable copy.
 */
export default function SettingsDialog({ open, onClose, theme, onToggleTheme }: Props) {
  const { t, setLang, setCurrency, formatCurrency } = useI18n();
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const copy = SETTINGS_COPY[settings.language] ?? SETTINGS_COPY.en;

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
      description={copy.description}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-[var(--primary-bg)] px-4 py-1.5 text-[13px] font-medium text-[var(--primary-text)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]"
        >
          {copy.done}
        </button>
      }
    >
      <div className="space-y-6">
        {/* Appearance */}
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

        {/* Language */}
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

        {/* Currency */}
        <Section label={t("currency")} hint={copy.currencyHint}>
          <AnimatedSelect
            value={settings.currency}
            onChange={(value) => updateCurrency(value as CurrencyCode)}
            options={currencies.map(([code, meta]) => ({
              value: code,
              label: `${code} · ${meta.label} (${meta.symbol})`,
            }))}
          />
          <div className="mt-2 flex items-center justify-between rounded-md border border-[var(--line-soft)] bg-[var(--paper-soft-translucent)] px-3 py-2 text-[12px]">
            <span className="text-[var(--muted)]">{copy.currencyPreview}</span>
            <strong className="font-semibold text-[var(--ink)]">{formatCurrency(1250)}</strong>
          </div>
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
          "group flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left",
          "bg-[var(--input-bg)] transition-all duration-200 ease-out",
          "hover:-translate-y-0.5 hover:border-[var(--primary-bg)] hover:shadow-[0_10px_24px_-20px_rgba(0,0,0,0.45)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]/35",
          open ? "border-[var(--primary-bg)] shadow-[0_14px_28px_-22px_rgba(0,0,0,0.55)]" : "border-[var(--line)]",
        ].join(" ")}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 min-w-8 items-center justify-center rounded-md border border-[var(--line-soft)] bg-[var(--paper-soft-translucent)] px-2 text-[11px] font-semibold text-[var(--primary-bg)]">
            {selected.value.toUpperCase()}
          </span>
          <span className="block truncate text-[13px] font-medium text-[var(--ink)]">
            {selected.label}
          </span>
        </span>
        <ChevronDown
          size={16}
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
            className="mt-2 max-h-52 overflow-y-auto overflow-x-hidden rounded-lg border border-[var(--line)] bg-[var(--paper)] shadow-[0_18px_42px_-26px_rgba(0,0,0,0.55)]"
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
                          "flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 text-[10px] font-semibold transition-colors",
                          active
                            ? "border-[var(--primary-bg)] bg-[var(--paper)] text-[var(--primary-bg)]"
                            : "border-[var(--line-soft)] bg-[var(--input-bg)] text-[var(--muted)] group-hover:text-[var(--ink)]",
                        ].join(" ")}
                      >
                        {option.value.toUpperCase()}
                      </span>
                      <span className="block min-w-0 truncate text-[13px] font-medium">
                        {option.label}
                      </span>
                    </span>
                    <AnimatePresence initial={false}>
                      {active && (
                        <motion.span
                          initial={{ scale: 0.72, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.72, opacity: 0 }}
                          transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--primary-bg)] text-[var(--primary-text)]"
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
