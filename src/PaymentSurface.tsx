import App from "./App";
import { DisburseDynamicProvider } from "./lib/dynamic";

export default function PaymentSurface() {
  return (
    <DisburseDynamicProvider>
      <App />
    </DisburseDynamicProvider>
  );
}
