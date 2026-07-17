import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DisburseDynamicProvider } from "./lib/dynamic";
import { getDocsHref, isDocsHostname, shouldRedirectLegacyDocsRoute } from "./lib/routing";
import "./styles.css";

// The docs subdomain is read-only content — render it standalone, OUTSIDE the
// wallet provider, so docs.disburse.online never loads the heavy wallet SDK.
const DocsApp = lazy(() => import("./DocsApp"));

// /docs on any other host hops to the docs host before anything mounts, so the
// console shell never flashes around documentation. This includes naked
// localhost — docs.localhost resolves to loopback and the dev server answers.
if (shouldRedirectLegacyDocsRoute()) {
  window.location.replace(getDocsHref());
} else {
  const root = createRoot(document.getElementById("root")!);

  root.render(
    <StrictMode>
      {isDocsHostname() ? (
        <Suspense fallback={null}>
          <DocsApp />
        </Suspense>
      ) : (
        <DisburseDynamicProvider>
          <App />
        </DisburseDynamicProvider>
      )}
    </StrictMode>
  );
}
