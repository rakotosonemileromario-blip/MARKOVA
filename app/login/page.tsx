"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon, LogoMark } from "@/components/ui";
import Orb from "@/components/Orb";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message === "Invalid login credentials" ? "Email ou mot de passe incorrect." : error.message);
      setLoading(false);
      return;
    }
    window.location.href = "/";
  }

  const input =
    "w-full h-11 rounded-lg border border-[var(--hairline)] bg-soft px-3 text-[15px] outline-none focus:border-accent placeholder:text-muted";

  return (
    <main className="min-h-full flex items-center justify-center px-4 py-10 bg-[radial-gradient(ellipse_at_top,rgba(79,70,229,0.18),transparent_60%)]">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8 reveal">
          <div className="relative grid place-items-center size-28">
            <span className="absolute top-2 left-2 opacity-70">
              <Orb size={96} />
            </span>
            <span className="relative grid place-items-center size-20 rounded-full bg-bg/70 backdrop-blur border border-white/10">
              <LogoMark size={52} />
            </span>
          </div>
          <div className="mt-4 text-[28px] font-bold tracking-tight text-holo">MARKOVA AI</div>
          <div className="text-[13px] text-muted">Marketing Intelligence</div>
        </div>
        <form onSubmit={onSubmit} className="card p-6 space-y-4">
          <div>
            <label className="label-caps text-muted block mb-1.5" htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
          </div>
          <div>
            <label className="label-caps text-muted block mb-1.5" htmlFor="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={input}
            />
          </div>
          {error && (
            <p className="flex items-center gap-1.5 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
              <Icon name="error" className="text-[16px]" /> {error}
            </p>
          )}
          <button type="submit" disabled={loading} className="w-full h-11 rounded-lg bg-gradient-to-r from-accent-strong to-accent text-white font-semibold pulse-glow shine disabled:opacity-60">
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </form>
        <p className="mt-6 text-center text-[11px] text-muted label-caps">Comprendre · Expliquer · Optimiser</p>
      </div>
    </main>
  );
}
