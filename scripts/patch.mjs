import fs from "fs";

const file = "d:/Stressed/src/App.tsx";
let content = fs.readFileSync(file, "utf8");

// 1. Add import
content = content.replace(
  'import { getSupabaseBrowserClient } from "./lib/supabaseClient";\r\n',
  'import { getSupabaseBrowserClient } from "./lib/supabaseClient";\r\nimport LandingPage from "./LandingPage";\r\n'
);
content = content.replace(
  'import { getSupabaseBrowserClient } from "./lib/supabaseClient";\n',
  'import { getSupabaseBrowserClient } from "./lib/supabaseClient";\nimport LandingPage from "./LandingPage";\n'
);

// 2. Add 'landing' to Page type
content = content.replace(
  'type Page = "dashboard" | "payments" | "qr-payments" | "pay" | "import-export" | "docs";',
  'type Page = "landing" | "dashboard" | "payments" | "qr-payments" | "pay" | "import-export" | "docs";'
);

// 3. Update getInitialPage
const oldGetInitialPage = `function getInitialPage(): Page {
  if (isDocsHostname()) {
    return "docs";
  }
  const p = window.location.pathname;
  if (p === "/payments") return "payments";
  if (p === "/qr-payments") return "qr-payments";
  if (p === "/pay") return "pay";
  if (p === "/import-export") return "import-export";
  return "dashboard";
}`;

const newGetInitialPage = `function getInitialPage(): Page {
  const hostname = window.location.hostname;
  if (isDocsHostname(hostname)) {
    return "docs";
  }
  
  const isApp = hostname.startsWith("app.");
  const p = window.location.pathname;
  
  if (isApp) {
    if (p === "/payments") return "payments";
    if (p === "/qr-payments") return "qr-payments";
    if (p === "/pay") return "pay";
    if (p === "/import-export") return "import-export";
    return "dashboard";
  }
  
  return "landing";
}`;
content = content.replace(oldGetInitialPage, newGetInitialPage);
// Also try with \r\n
content = content.replace(oldGetInitialPage.replace(/\n/g, "\r\n"), newGetInitialPage.replace(/\n/g, "\r\n"));

// 4. Update return statement of App()
content = content.replace(
  '  return (\n    <main className="site-shell">',
  '  if (page === "landing") {\n    return <LandingPage />;\n  }\n\n  return (\n    <main className="site-shell">'
);
content = content.replace(
  '  return (\r\n    <main className="site-shell">',
  '  if (page === "landing") {\r\n    return <LandingPage />;\r\n  }\r\n\r\n  return (\r\n    <main className="site-shell">'
);

fs.writeFileSync(file, content);
console.log("Patched App.tsx successfully");
