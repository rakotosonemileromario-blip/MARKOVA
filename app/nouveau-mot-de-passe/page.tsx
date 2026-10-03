"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Après le lien « mot de passe oublié » : choisir un nouveau mot de passe. */
export default function NewPasswordPage() {
  const [pwd, setPwd] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pwd.length < 8) return setMsg("⚠️ 8 caractères minimum.");
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password: pwd });
    setBusy(false);
    if (error) return setMsg(`⚠️ ${error.message}`);
    window.location.href = "/";
  }

  return (
    <main className="min-h-full flex items-center justify-center px-4 py-10">
      <form onSubmit={save} className="card w-full max-w-sm p-6 space-y-4">
        <h1 className="text-[22px] font-bold">Choisis ton nouveau mot de passe</h1>
        <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" placeholder="8 caractères minimum" className="field" autoFocus />
        <button disabled={busy} className="btn btn-primary w-full !h-12">{busy ? "Enregistrement…" : "Enregistrer et entrer"}</button>
        {msg && <p className="text-[14px]">{msg}</p>}
      </form>
    </main>
  );
}
