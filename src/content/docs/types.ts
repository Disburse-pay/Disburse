export type DocsSection = {
  title: string;
  body: string[];
  points?: string[];
  code?: string;
};

export type DocsSummaryItem = {
  label: string;
  value: string;
};

/** Single doc page in gitbook layout — one URL fragment, several sections. */
export type DocsPage = {
  slug: string;
  title: string;
  sections: DocsSection[];
};

/** Top-level category in the gitbook sidebar (e.g. "App", "Bet"). */
export type DocsCategory = {
  slug: "app" | "bet";
  title: string;
  pages: DocsPage[];
};
