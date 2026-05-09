export type LanguageCode = "en" | "de" | "id" | "ng" | "hi" | "zh";
export type CurrencyCode = "USD" | "EUR" | "IDR" | "NGN" | "INR" | "CNY";
export type ColorTone = "emerald" | "blue" | "amber" | "violet" | "rose";

export interface AppSettings {
  language: LanguageCode;
  currency: CurrencyCode;
  colorTone: ColorTone;
}

export const LANGUAGE_META: Record<LanguageCode, { label: string; native: string; currency: CurrencyCode }> = {
  en: { label: "English", native: "English", currency: "USD" },
  de: { label: "German", native: "Deutsch", currency: "EUR" },
  id: { label: "Indonesian", native: "Bahasa Indonesia", currency: "IDR" },
  ng: { label: "Nigeria", native: "Nigeria", currency: "NGN" },
  hi: { label: "India", native: "हिन्दी", currency: "INR" },
  zh: { label: "China", native: "中文", currency: "CNY" },
};

export const CURRENCY_META: Record<CurrencyCode, { symbol: string; locale: string; label: string; usdRate: number }> = {
  USD: { symbol: "$",  locale: "en-US", label: "US Dollar",        usdRate: 1 },
  EUR: { symbol: "€",  locale: "de-DE", label: "Euro",             usdRate: 0.92 },
  IDR: { symbol: "Rp", locale: "id-ID", label: "Indonesian Rupiah", usdRate: 15850 },
  NGN: { symbol: "₦",  locale: "en-NG", label: "Nigerian Naira",    usdRate: 1580 },
  INR: { symbol: "₹",  locale: "hi-IN", label: "Indian Rupee",      usdRate: 83.4 },
  CNY: { symbol: "¥",  locale: "zh-CN", label: "Chinese Yuan",      usdRate: 7.25 },
};

/** Format a USDC-denominated amount in the user's chosen display currency. */
export function formatCurrency(amountUsd: number | string, currency: CurrencyCode): string {
  const value = typeof amountUsd === "string" ? Number(amountUsd) : amountUsd;
  if (!Number.isFinite(value)) return "—";
  const meta = CURRENCY_META[currency] ?? CURRENCY_META.USD;
  const converted = value * meta.usdRate;
  try {
    return new Intl.NumberFormat(meta.locale, {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "IDR" ? 0 : 2,
      minimumFractionDigits: currency === "IDR" ? 0 : 2,
    }).format(converted);
  } catch {
    return `${meta.symbol}${converted.toFixed(2)}`;
  }
}

export function getCurrencySymbol(currency: CurrencyCode): string {
  return CURRENCY_META[currency]?.symbol ?? "$";
}

export const COLOR_TONE_META: Record<ColorTone, { label: string; hex: string }> = {
  emerald: { label: "Emerald", hex: "#34d399" },
  blue: { label: "Blue", hex: "#60a5fa" },
  amber: { label: "Amber", hex: "#f59e0b" },
  violet: { label: "Violet", hex: "#a78bfa" },
  rose: { label: "Rose", hex: "#f43f5e" },
};

const SETTINGS_KEY = "disburse.settings";

export const defaultSettings: AppSettings = {
  language: "en",
  currency: "USD",
  colorTone: "emerald",
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      language: parsed.language ?? defaultSettings.language,
      currency: parsed.currency ?? defaultSettings.currency,
      colorTone: parsed.colorTone ?? defaultSettings.colorTone,
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function applyColorTone(tone: ColorTone): void {
  document.documentElement.dataset.tone = tone;
}
