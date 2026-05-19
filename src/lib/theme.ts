export type Theme = "light" | "dark";

export const THEME_KEY = "disburse.theme";
export const LEGACY_THEME_KEY = "arc-pay-desk.theme";

export function getInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY) ?? localStorage.getItem(LEGACY_THEME_KEY);
  const nextTheme = stored === "light" || stored === "dark" ? stored : "light";
  document.documentElement.dataset.theme = nextTheme;
  return nextTheme;
}
