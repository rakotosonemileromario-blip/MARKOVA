import { Suspense } from "react";
import MarketBoard from "./MarketBoard";

export default function MarchePage() {
  return (
    <Suspense>
      <MarketBoard />
    </Suspense>
  );
}
