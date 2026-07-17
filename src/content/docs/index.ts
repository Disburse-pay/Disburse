import type { LanguageCode } from "../../lib/settings";
import { slugify } from "../../lib/cx";
import type { DocsCategory, DocsPage, DocsSection, DocsSummaryItem } from "./types";
import { docsSections, arcadeSections, docsSummaryItems } from "./en";
import { docsSectionsId, arcadeSectionsId, docsSummaryItemsId } from "./id";
import { docsSectionsDe, arcadeSectionsDe, docsSummaryItemsDe } from "./de";
import { docsSectionsHi, arcadeSectionsHi, docsSummaryItemsHi } from "./hi";
import { docsSectionsZh, arcadeSectionsZh, docsSummaryItemsZh } from "./zh";

export type { DocsSection, DocsSummaryItem, DocsPage, DocsCategory } from "./types";

export function getDocsSections(lang: LanguageCode): DocsSection[] {
  if (lang === "de") return docsSectionsDe;
  if (lang === "id") return docsSectionsId;
  if (lang === "hi") return docsSectionsHi;
  if (lang === "zh") return docsSectionsZh;
  return docsSections;
}

export function getArcadeSections(lang: LanguageCode): DocsSection[] {
  if (lang === "de") return arcadeSectionsDe;
  if (lang === "id") return arcadeSectionsId;
  if (lang === "hi") return arcadeSectionsHi;
  if (lang === "zh") return arcadeSectionsZh;
  return arcadeSections;
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
 * Gitbook categories for /docs. "App" is the payments / QR / PSP surface,
 * "Arcade" is Cluck Run, the coin-op game deployed separately at
 * arcade.disburse.online. Both are sourced from the locale files.
 */
export function getDocsCategories(lang: LanguageCode): DocsCategory[] {
  return [
    {
      slug: "app",
      title: "App",
      pages: appPagesFromSections(getDocsSections(lang)),
    },
    {
      slug: "arcade",
      title: "Arcade",
      pages: appPagesFromSections(getArcadeSections(lang)),
    },
  ];
}
