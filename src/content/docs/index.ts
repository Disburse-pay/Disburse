import type { LanguageCode } from "../../lib/settings";
import { slugify } from "../../lib/cx";
import type { DocsCategory, DocsPage, DocsSection, DocsSummaryItem } from "./types";
import { docsSections, docsSummaryItems } from "./en";
import { docsSectionsId, docsSummaryItemsId } from "./id";
import { docsSectionsDe, docsSummaryItemsDe } from "./de";
import { docsSectionsHi, docsSummaryItemsHi } from "./hi";
import { docsSectionsZh, docsSummaryItemsZh } from "./zh";
import { betPages } from "./bet";

export type { DocsSection, DocsSummaryItem, DocsPage, DocsCategory } from "./types";

export function getDocsSections(lang: LanguageCode): DocsSection[] {
  if (lang === "de") return docsSectionsDe;
  if (lang === "id") return docsSectionsId;
  if (lang === "hi") return docsSectionsHi;
  if (lang === "zh") return docsSectionsZh;
  return docsSections;
}

export function getDocsSummaryItems(lang: LanguageCode): DocsSummaryItem[] {
  if (lang === "de") return docsSummaryItemsDe;
  if (lang === "id") return docsSummaryItemsId;
  if (lang === "hi") return docsSummaryItemsHi;
  if (lang === "zh") return docsSummaryItemsZh;
  return docsSummaryItems;
}

/**
 * Wrap the existing flat DocsSection list for a locale into one page per
 * section. Each section becomes its own gitbook-style page in the sidebar.
 */
function appPagesFromSections(sections: DocsSection[]): DocsPage[] {
  return sections.map((s) => ({
    slug: slugify(s.title),
    title: s.title,
    sections: [s],
  }));
}

/**
 * Gitbook categories for /docs. Two top-level groups: "App" (the payments /
 * QR / PSP surface, sourced from the locale files) and "Bet" (markets +
 * lending, authored in English with no translation fallback yet).
 */
export function getDocsCategories(lang: LanguageCode): DocsCategory[] {
  return [
    {
      slug: "app",
      title: "App",
      pages: appPagesFromSections(getDocsSections(lang)),
    },
    {
      slug: "bet",
      title: "Bet",
      pages: betPages,
    },
  ];
}
