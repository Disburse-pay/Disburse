import BridgeApp from "./bridge/BridgeApp";
import { DisburseDynamicProvider } from "./lib/dynamic";

export default function BridgeSurface() {
  return (
    <DisburseDynamicProvider surface="bridge">
      <BridgeApp />
    </DisburseDynamicProvider>
  );
}
