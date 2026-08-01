import type { LanguageCode } from "../../lib/settings";
import { slugify } from "../../lib/cx";
import type { DocsCategory, DocsPage, DocsSection, DocsSummaryItem } from "./types";
import { docsSections, docsSummaryItems } from "./en";
import { docsSectionsId, docsSummaryItemsId } from "./id";
import { docsSectionsDe, docsSummaryItemsDe } from "./de";
import { docsSectionsHi, docsSummaryItemsHi } from "./hi";
import { docsSectionsZh, docsSummaryItemsZh } from "./zh";

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
function pagesFromSections(sections: DocsSection[]): DocsPage[] {
  return sections.map((s) => ({
    slug: slugify(s.title),
    title: s.title,
    sections: [s]
  }));
}

function pickSections(sections: DocsSection[], indexes: number[]): DocsSection[] {
  return indexes.flatMap((index) => (sections[index] ? [sections[index]] : []));
}

/** Product-oriented navigation for the payment, ledger, and trust surfaces. */
export function getDocsCategories(lang: LanguageCode): DocsCategory[] {
  const sections = getDocsSections(lang);
  return [
    {
      slug: "start",
      title: "Start",
      pages: pagesFromSections(pickSections(sections, [0, 4]))
    },
    {
      slug: "integrate",
      title: "Integrate",
      pages: pagesFromSections(pickSections(sections, [5, 6, 11]))
    },
    {
      slug: "operate",
      title: "Operate",
      pages: pagesFromSections(pickSections(sections, [7, 8, 10]))
    },
    {
      slug: "trust",
      title: "Trust",
      pages: pagesFromSections(pickSections(sections, [2, 3, 9, 1]))
    }
  ];
}
