"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getVoice, setVoice, speak, stopSpeaking } from "@/lib/voice";
import { VOICES, type VoiceId } from "@/lib/voices";
import { Icon } from "@/components/ui";

type Member = { id: string; email: string; name: string; created_at: string; last_sign_in_at: string | null; me: boolean };

export default function SettingsPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-6 space-y-5">
        <div>
          <h1 className="page-title">⚙️ Paramètres</h1>
          <p className="page-sub">Ton compte, la voix de Kimia et ton équipe.</p>
        </div>
        <Profile />
        <VoicePicker />
        <Team />
        <section className="card p-4">
          <h2 className="text-[18px] font-bold">🧩 Autres réglages</h2>
          <div className="mt-3 grid sm:grid-cols-2 gap-2">
            <Link href="/connexions" className="btn justify-start"><Icon name="hub" className="text-[20px] text-accent-text" /> Mes connexions (mail, Facebook…)</Link>
            <Link href="/notifications" className="btn justify-start"><Icon name="notifications" className="text-[20px] text-accent-text" /> Alertes et rapport du lundi</Link>
            <Link href="/competences" className="btn justify-start"><Icon name="extension" className="text-[20px] text-accent-text" /> Compétences de Kimia</Link>
            <Link href="/memoire" className="btn justify-start"><Icon name="psychology" className="text-[20px] text-accent-text" /> Ce que Kimia retient</Link>
          </div>
        </section>
      </div>
    </div>
  );
}

function Profile() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        setName(String(data.user?.user_metadata?.name ?? ""));
        setEmail(data.user?.email ?? "");
      });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (pwd && pwd.length < 8) return setMsg("⚠️ Le mot de passe doit faire au moins 8 caractères.");
    const { error } = await createClient().auth.updateUser({ data: { name: name.trim() }, ...(pwd ? { password: pwd } : {}) });
    setMsg(error ? `⚠️ ${error.message}` : pwd ? "✅ Prénom et mot de passe enregistrés." : "✅ Prénom enregistré.");
    setPwd("");
  }

  return (
    <form onSubmit={save} className="card p-4 space-y-3">
      <h2 className="text-[18px] font-bold">👤 Mon compte</h2>
      <p className="text-[14px] text-muted -mt-1">Connecté avec {email}</p>
      <label className="block">
        <span className="text-[14px] font-semibold">Comment Kimia doit t&apos;appeler</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ton prénom" className="field mt-1" />
      </label>
      <label className="block">
        <span className="text-[14px] font-semibold">Nouveau mot de passe (laisse vide pour le garder)</span>
        <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" placeholder="8 caractères minimum" className="field mt-1" />
      </label>
      <button className="btn btn-primary w-full sm:w-auto">Enregistrer</button>
      {msg && <p className="text-[14px]">{msg}</p>}
    </form>
  );
}

function VoicePicker() {
  const [voice, setV] = useState<VoiceId | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => setV(getVoice()), []);

  async function test(id: VoiceId) {
    setPlaying(id);
    await speak("Bonjour ! Je suis Kimia, ton assistante marketing. Voici ma voix : tu peux la garder ou en choisir une autre.", id);
    setTimeout(() => setPlaying(null), 6000);
  }

  return (
    <section className="card p-4">
      <h2 className="text-[18px] font-bold">🎙️ La voix de Kimia</h2>
      <p className="text-[14px] text-muted mt-0.5">Voix humaines gratuites. Appuie sur « Écouter », puis choisis celle que tu préfères.</p>
      <div className="mt-3 space-y-2">
        {VOICES.map((v) => (
          <div key={v.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${voice === v.id ? "border-accent bg-accent-soft" : "border-line"}`}>
            <button
              onClick={() => {
                setV(v.id);
                setVoice(v.id);
              }}
              className="flex-1 min-w-0 text-left"
              aria-pressed={voice === v.id}
            >
              <span className="flex items-center gap-2 text-[16px] font-bold">
                <Icon name={voice === v.id ? "radio_button_checked" : "radio_button_unchecked"} className="text-[22px] text-accent-text" />
                {v.label}
                <span className="text-[13px] font-semibold text-muted">· {v.accent}</span>
              </span>
              <span className="block pl-8 text-[13px] text-muted">{v.note}</span>
            </button>
            <button
              onClick={() => (playing === v.id ? (stopSpeaking(), setPlaying(null)) : test(v.id))}
              className="btn btn-sm shrink-0"
            >
              <Icon name={playing === v.id ? "stop" : "play_arrow"} filled className="text-[20px]" /> {playing === v.id ? "Stop" : "Écouter"}
            </button>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[13px] text-muted">Le choix est gardé sur cet appareil. Sans Internet, Kimia utilise la voix du téléphone.</p>
    </section>
  );
}

function Team() {
  const [state, setState] = useState<"loading" | "owner" | "member" | "error">("loading");
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/equipe");
    const json = await res.json().catch(() => ({}));
    if (res.status === 403) return setState("member");
    if (!res.ok) {
      setError(json.error ?? "Erreur");
      return setState("error");
    }
    setMembers(json.members ?? []);
    setState("owner");
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/equipe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Création impossible");
    setCreated(json);
    setName("");
    setEmail("");
    load();
  }

  async function remove(m: Member) {
    if (!confirm(`Supprimer le compte de ${m.name || m.email} ? Tous ses projets, fichiers et discussions seront effacés.`)) return;
    await fetch("/api/equipe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: m.id }) });
    load();
  }

  const loginUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";
  const share = created
    ? `Bonjour ${created.name} ! Voici ton accès à MARKOVA (Kimia, assistante marketing) :\n${loginUrl}\nEmail : ${created.email}\nMot de passe : ${created.password}\nTu pourras changer ton mot de passe dans Paramètres.`
    : "";

  if (state === "member") {
    return (
      <section className="card p-4">
        <h2 className="text-[18px] font-bold">👥 Équipe</h2>
        <p className="mt-1 text-[14px] text-muted">Ton espace est personnel : tes projets, fichiers et connexions ne sont visibles que par toi.</p>
      </section>
    );
  }

  return (
    <section className="card p-4">
      <h2 className="text-[18px] font-bold">👥 Mon équipe</h2>
      <p className="text-[14px] text-muted mt-0.5">
        Crée un compte pour chaque collègue. Chacun a <b>son propre espace</b> (projets, fichiers) et connecte <b>ses propres comptes</b> (mail, Facebook, Google).
      </p>
      {state === "loading" && <p className="mt-3 text-muted">Chargement…</p>}
      {state === "error" && <p className="mt-3 text-[14px]">⚠️ {error}</p>}

      {state === "owner" && (
        <>
          <form onSubmit={create} className="mt-3 grid sm:grid-cols-[1fr_1.4fr_auto] gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Prénom" className="field" required />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email du collègue" className="field" required />
            <button disabled={busy} className="btn btn-primary">
              <Icon name="person_add" className="text-[20px]" /> {busy ? "Création…" : "Créer"}
            </button>
          </form>
          {error && <p className="mt-2 text-[14px] text-danger">⚠️ {error}</p>}

          {created && (
            <div className="mt-3 rounded-xl border border-ok/40 bg-ok-soft p-3">
              <div className="text-[15px] font-bold">✅ Compte créé pour {created.name}</div>
              <p className="text-[14px] mt-1">Envoie-lui ce message (le mot de passe n&apos;est affiché qu&apos;une fois) :</p>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-panel border border-line p-3 text-[14px]">{share}</pre>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => navigator.clipboard?.writeText(share)} className="btn btn-sm">
                  <Icon name="content_copy" className="text-[18px]" /> Copier
                </button>
                <a href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noreferrer" className="btn btn-sm">
                  <Icon name="chat" className="text-[18px]" /> WhatsApp
                </a>
                <a href={`mailto:${created.email}?subject=${encodeURIComponent("Ton accès à MARKOVA")}&body=${encodeURIComponent(share)}`} className="btn btn-sm">
                  <Icon name="mail" className="text-[18px]" /> Email
                </a>
              </div>
            </div>
          )}

          <ul className="mt-4 space-y-1.5">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-xl bg-soft/60 border border-[var(--hairline)] px-3 py-2.5">
                <span className="grid place-items-center size-9 rounded-full bg-accent-soft text-accent-text font-bold uppercase shrink-0">{(m.name || m.email).slice(0, 1)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[15px] font-semibold">
                    {m.name || m.email} {m.me && <span className="text-[13px] text-muted">(toi)</span>}
                  </span>
                  <span className="block truncate text-[13px] text-muted">
                    {m.email} · {m.last_sign_in_at ? `dernière connexion ${new Date(m.last_sign_in_at).toLocaleDateString("fr-FR")}` : "jamais connecté"}
                  </span>
                </span>
                {!m.me && (
                  <button onClick={() => remove(m)} className="btn btn-ghost btn-sm !px-2 !text-danger" aria-label={`Supprimer ${m.name || m.email}`}>
                    <Icon name="person_remove" className="text-[20px]" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
