"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon, LogoMark } from "@/components/ui";
import Orb from "@/components/Orb";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    const supabase = createClient();
    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/callback?next=/nouveau-mot-de-passe` });
      setLoading(false);
      if (error) return setError(error.message);
      return setInfo("📩 Si ce compte existe, un email vient de partir avec un lien pour choisir un nouveau mot de passe. Pense à regarder les spams.");
    }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(error.message === "Invalid login credentials" ? "Email ou mot de passe incorrect." : error.message);
      setLoading(false);
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="min-h-full flex items-center justify-center px-4 py-10 bg-[radial-gradient(ellipse_at_top,rgba(79,70,229,0.18),transparent_60%)]">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-7 reveal">
          <div className="relative grid place-items-center size-28">
            <span className="absolute top-2 left-2 opacity-70">
              <Orb size={96} />
            </span>
            <span className="relative grid place-items-center size-20 rounded-full overflow-hidden border-2 border-white/15 shadow-[0_0_30px_rgba(99,102,241,0.45)]">
              <LogoMark size={80} />
            </span>
          </div>
          <div className="mt-4 text-[30px] font-extrabold tracking-tight text-holo">MARKOVA</div>
          <div className="text-[16px] text-muted">Kimia, ton assistante marketing</div>
        </div>

        <form onSubmit={onSubmit} className="card p-6 space-y-4">
          <h1 className="text-[20px] font-bold">{mode === "login" ? "Se connecter" : "Mot de passe oublié"}</h1>
          <label className="block">
            <span className="text-[15px] font-semibold">Email</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="field mt-1" placeholder="ton@email.com" />
          </label>
          {mode === "login" && (
            <label className="block">
              <span className="text-[15px] font-semibold">Mot de passe</span>
              <div className="relative mt-1">
                <input
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 btn btn-ghost btn-sm !px-2"
                  aria-label={show ? "Cacher le mot de passe" : "Afficher le mot de passe"}
                >
                  <Icon name={show ? "visibility_off" : "visibility"} className="text-[20px]" />
                </button>
              </div>
            </label>
          )}
          {error && (
            <p className="flex items-center gap-1.5 rounded-xl bg-danger-soft px-3 py-2.5 text-[14px] text-danger">
              <Icon name="error" className="text-[18px]" /> {error}
            </p>
          )}
          {info && <p className="rounded-xl bg-ok-soft px-3 py-2.5 text-[14px]">{info}</p>}
          <button type="submit" disabled={loading} className="btn btn-primary w-full !h-12 !text-[16px]">
            {loading ? "Un instant…" : mode === "login" ? "Se connecter" : "Recevoir le lien"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "forgot" : "login");
              setError(null);
              setInfo(null);
            }}
            className="w-full text-center text-[14px] font-semibold text-accent-text"
          >
            {mode === "login" ? "Mot de passe oublié ?" : "← Revenir à la connexion"}
          </button>
        </form>
        <p className="mt-5 text-center text-[14px] text-muted">Pas de compte ? Demande à la personne qui gère MARKOVA de t&apos;en créer un.</p>
      </div>
    </main>
  );
}
