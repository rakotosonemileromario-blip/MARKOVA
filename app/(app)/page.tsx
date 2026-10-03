import { Suspense } from "react";
import Chat from "@/components/Chat";

/** Accueil : on arrive directement dans la discussion avec Kimia. */
export default function HomePage() {
  return (
    <Suspense>
      <Chat />
    </Suspense>
  );
}
