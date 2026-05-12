import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DisburseDynamicProvider } from "./lib/dynamic";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DisburseDynamicProvider>
      <App />
    </DisburseDynamicProvider>
  </StrictMode>
);
