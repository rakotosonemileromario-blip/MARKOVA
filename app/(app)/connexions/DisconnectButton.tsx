"use client";

import { useState } from "react";

export default function DisconnectButton({ id, email }: { id: string; email: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        if (!confirm(`Déconnecter ${email} ? Kimia n'aura plus accès à ses mails, son agenda, Drive et ses tâches.`)) return;
        setBusy(true);
        await fetch("/api/google/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        window.location.href = "/connexions";
      }}
      className="rounded-lg border border-line h-8 px-2.5 text-[12px] font-semibold text-danger hover:bg-danger-soft disabled:opacity-50"
    >
      {busy ? "…" : "Déconnecter"}
    </button>
  );
}
