import type { LanguageCode } from "../../lib/settings";
import type { DocsSection, DocsSummaryItem } from "./types";
import { docsSections, docsSummaryItems } from "./en";
import { docsSectionsId, docsSummaryItemsId } from "./id";
import { docsSectionsDe, docsSummaryItemsDe } from "./de";
import { docsSectionsHi, docsSummaryItemsHi } from "./hi";
import { docsSectionsZh, docsSummaryItemsZh } from "./zh";

export type { DocsSection, DocsSummaryItem } from "./types";

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
