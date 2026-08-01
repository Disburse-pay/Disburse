import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import SurfaceLoader from "./components/SurfaceLoader";
import {
  getDocsHref,
  getInitialPage,
  isBridgeSurface,
  isDocsHostname,
  shouldRedirectLegacyDocsRoute
} from "./lib/routing";
import "./styles.css";

// Public, docs, payment, and bridge surfaces are independent bundles. The
// landing and docs hosts never download a wallet SDK or payment console.
const DocsApp = lazy(() => import("./DocsApp"));
const LandingPage = lazy(() => import("./landing/LandingPage"));
const PaymentSurface = lazy(() => import("./PaymentSurface"));
const BridgeSurface = lazy(() => import("./BridgeSurface"));

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
        <Suspense fallback={<SurfaceLoader label="Opening documentation" />}>
          <DocsApp />
        </Suspense>
      ) : isBridgeSurface() ? (
        <Suspense fallback={<SurfaceLoader label="Opening bridge" />}>
          <BridgeSurface />
        </Suspense>
      ) : getInitialPage() === "landing" ? (
        <Suspense fallback={<SurfaceLoader label="Preparing payment gateway" />}>
          <LandingPage />
        </Suspense>
      ) : (
        <Suspense fallback={<SurfaceLoader label="Opening payment console" />}>
          <PaymentSurface />
        </Suspense>
      )}
    </StrictMode>
  );
}
