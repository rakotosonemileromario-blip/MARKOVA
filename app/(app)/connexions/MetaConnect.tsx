"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui";

type Props = {
  connected: { name: string; expiresAt: string | null } | null;
  appReady: boolean;
  appFromEnv: boolean;
  openPicker: boolean;
};

/** Meta : assistant de préparation (une fois) → « Connecter avec Facebook » → choix des pages et comptes. */
export default function MetaConnect({ connected, appReady, appFromEnv, openPicker }: Props) {
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveToken(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/meta/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Jeton refusé");
      setBusy(false);
      return;
    }
    window.location.href = `/connexions?ok=${encodeURIComponent(`Meta (${json.name})`)}&meta=choisir`;
  }

  async function disconnect() {
    if (!confirm("Déconnecter Facebook ? MARKOVA n'aura plus accès à tes pages, comptes Instagram et publicités.")) return;
    setBusy(true);
    await fetch("/api/meta/disconnect", { method: "POST" });
    window.location.href = "/connexions";
  }

  const days = connected?.expiresAt ? Math.round((new Date(connected.expiresAt).getTime() - Date.now()) / 86_400_000) : null;

  return (
    <div>
      {connected ? (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-soft border border-line px-3 py-2.5">
            <span className="size-2 rounded-full bg-ok shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="truncate text-[14px] font-semibold">{connected.name}</div>
              <div className={`text-[12px] ${days != null && days < 10 ? "text-warn" : "text-muted"}`}>
                {days == null ? "Accès sans expiration" : days > 0 ? `Accès valable encore ${days} jours` : "Accès expiré : reconnecte Facebook"}
              </div>
            </div>
            {appReady && (
              <a href="/api/meta/connect" className="rounded-lg border border-line h-8 px-2.5 inline-flex items-center text-[12px] font-semibold">
                Reconnecter
              </a>
            )}
            <button onClick={disconnect} disabled={busy} className="rounded-lg border border-line h-8 px-2.5 text-[12px] font-semibold text-danger hover:bg-danger-soft">
              Déconnecter
            </button>
          </div>
          <AssetPicker initiallyOpen={openPicker} />
        </>
      ) : appReady ? (
        <div>
          <a
            href="/api/meta/connect"
            className="shine rounded-xl bg-[#1877f2] text-white h-12 px-5 inline-flex items-center gap-2.5 text-[15px] font-semibold shadow-[0_8px_28px_-8px_#1877f2]"
          >
            <FacebookLogo /> Connecter avec Facebook
          </a>
          <p className="mt-2 text-[12px] text-muted">Facebook te demandera quelles pages, comptes Instagram et comptes publicitaires partager avec MARKOVA.</p>
          {!appFromEnv && <ForgetApp />}
        </div>
      ) : (
        <SetupWizard />
      )}

      {!connected && (
        <button onClick={() => setShowToken((v) => !v)} className="mt-4 block text-[12px] text-muted underline underline-offset-2">
          Option avancée : coller un jeton
        </button>
      )}
      {showToken && !connected && (
        <form onSubmit={saveToken} className="mt-3 space-y-2">
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            rows={3}
            placeholder="Jeton d'accès Meta (utilisateur système du Business Manager, ou jeton utilisateur)"
            className="w-full rounded-lg border border-line bg-soft px-3 py-2 text-[13px] font-mono outline-none focus:border-accent"
          />
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <button disabled={busy || token.trim().length < 30} className="rounded-lg bg-accent-strong text-white h-10 px-4 text-[13px] font-semibold disabled:opacity-50">
            {busy ? "Vérification…" : "Enregistrer le jeton"}
          </button>
        </form>
      )}
    </div>
  );
}

function FacebookLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.88v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z" />
    </svg>
  );
}

// ─── Préparation (une seule fois) ────────────────────────────────
function SetupWizard() {
  const [redirect, setRedirect] = useState("");
  const [copied, setCopied] = useState(false);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [configId, setConfigId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setRedirect(`${window.location.origin}/api/meta/callback`), []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/meta/app", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, appSecret, configId }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Enregistrement impossible");
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  const step = "grid place-items-center size-7 rounded-full bg-accent-strong text-white text-[13px] font-bold shrink-0";
  const input = "w-full h-10 rounded-lg border border-line bg-soft px-3 text-[14px] outline-none focus:border-accent";

  return (
    <div className="rounded-xl border border-accent/30 bg-accent-soft/40 p-4">
      <p className="text-[13px] leading-relaxed">
        <strong>Une seule fois, ~5 minutes.</strong> Meta exige qu'une connexion Facebook passe par une « app » à ton nom (gratuite, privée,
        personne d'autre ne la voit). Ensuite, tu n'auras plus qu'à cliquer sur « Connecter avec Facebook ».
      </p>

      <ol className="mt-4 space-y-4">
        <li className="flex gap-3">
          <span className={step}>1</span>
          <div className="text-[13px]">
            <a href="https://developers.facebook.com/apps/creation/" target="_blank" rel="noreferrer" className="font-semibold text-accent-text underline">
              Créer l'app Meta ↗
            </a>
            <div className="text-muted mt-0.5">Nom : MARKOVA · Cas d'usage : « Autre » · Type : « Entreprise ».</div>
          </div>
        </li>
        <li className="flex gap-3">
          <span className={step}>2</span>
          <div className="text-[13px] min-w-0 flex-1">
            <div className="font-semibold">Ajouter « Facebook Login for Business » et « Marketing API »</div>
            <div className="text-muted mt-0.5">Dans l'app : Ajouter un produit. Puis Facebook Login for Business → Paramètres → « URI de redirection OAuth valides » :</div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <code className="flex-1 min-w-0 truncate rounded-md bg-bg border border-line px-2 py-1.5 text-[12px]">{redirect}</code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(redirect);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="shrink-0 rounded-md border border-line h-8 px-2.5 text-[12px] font-semibold"
              >
                {copied ? "Copié ✓" : "Copier"}
              </button>
            </div>
            <div className="text-muted mt-1.5">
              Recommandé : Facebook Login for Business → Configurations → Créer (jeton d'accès utilisateur ; cocher pages, Instagram, publicités) → copier l'ID de
              configuration.
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <span className={step}>3</span>
          <form onSubmit={save} className="text-[13px] min-w-0 flex-1 space-y-2">
            <div className="font-semibold">Coller les identifiants (Paramètres de l'app → Général)</div>
            <input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="ID de l'app (chiffres, ex. 1234567890123456)" inputMode="numeric" autoComplete="off" name="meta-app-id" className={input} />
            <input value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="Clé secrète de l'app (pas votre mot de passe Facebook)" type="password" autoComplete="new-password" name="meta-app-secret" className={input} />
            <input value={configId} onChange={(e) => setConfigId(e.target.value)} placeholder="ID de configuration (facultatif)" inputMode="numeric" autoComplete="off" name="meta-config-id" className={input} />
            {error && <p className="text-[12px] text-danger">{error}</p>}
            <button disabled={busy || !appId || !appSecret} className="w-full rounded-lg bg-accent-strong text-white h-10 text-[13px] font-semibold disabled:opacity-50">
              {busy ? "Vérification auprès de Meta…" : "Enregistrer et afficher le bouton Facebook"}
            </button>
            <p className="text-[11px] text-muted">La clé secrète est vérifiée auprès de Meta puis chiffrée ; elle n'est jamais affichée.</p>
          </form>
        </li>
      </ol>
    </div>
  );
}

function ForgetApp() {
  return (
    <button
      onClick={async () => {
        if (!confirm("Oublier l'app Meta enregistrée ? Il faudra ressaisir ses identifiants.")) return;
        await fetch("/api/meta/app", { method: "DELETE" });
        window.location.reload();
      }}
      className="mt-2 block text-[11px] text-muted underline underline-offset-2"
    >
      Changer d'app Meta
    </button>
  );
}

// ─── Choix des pages et comptes ──────────────────────────────────
type Assets = {
  pages: { id: string; name: string; instagram: string | null }[];
  adAccounts: { id: string; name: string; currency: string; active: boolean }[];
  selection: { pages?: string[]; adAccounts?: string[] };
};

function AssetPicker({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [ads, setAds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open || assets) return;
    fetch("/api/meta/assets")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return setError(j.error);
        setAssets(j);
        // Aucune sélection enregistrée = tout est utilisé.
        setPages(j.selection?.pages?.length ? j.selection.pages : j.pages.map((p: { id: string }) => p.id));
        setAds(j.selection?.adAccounts?.length ? j.selection.adAccounts : j.adAccounts.map((a: { id: string }) => a.id));
      })
      .catch((e) => setError(String(e)));
  }, [open, assets]);

  async function save() {
    await fetch("/api/meta/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages, adAccounts: ads }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line h-9 px-3 text-[13px] font-semibold">
        <Icon name="checklist" className="text-[18px]" /> Choisir les pages et comptes
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-line bg-soft/60 p-4">
      <div className="font-semibold text-[14px]">Pages et comptes utilisés par MARKOVA</div>
      {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
      {!assets && !error && <div className="mt-3 skeleton h-24 rounded-lg" />}
      {assets && (
        <>
          <div className="mt-3 label-caps text-muted">Pages Facebook et Instagram</div>
          <div className="mt-1.5 space-y-1">
            {assets.pages.length === 0 && <p className="text-[13px] text-muted">Aucune page partagée. Clique sur « Reconnecter » et coche tes pages dans la fenêtre Facebook.</p>}
            {assets.pages.map((p) => (
              <label key={p.id} className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-panel cursor-pointer text-[13px]">
                <input type="checkbox" className="accent-[var(--accent)] size-4" checked={pages.includes(p.id)} onChange={() => toggle(pages, setPages, p.id)} />
                <Icon name="flag" className="text-[17px] text-[#1877f2]" />
                <span className="flex-1 truncate font-medium">{p.name}</span>
                {p.instagram && <span className="text-[12px] text-muted">📸 @{p.instagram}</span>}
              </label>
            ))}
          </div>
          <div className="mt-4 label-caps text-muted">Comptes publicitaires</div>
          <div className="mt-1.5 space-y-1">
            {assets.adAccounts.length === 0 && <p className="text-[13px] text-muted">Aucun compte publicitaire partagé.</p>}
            {assets.adAccounts.map((a) => (
              <label key={a.id} className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-panel cursor-pointer text-[13px]">
                <input type="checkbox" className="accent-[var(--accent)] size-4" checked={ads.includes(a.id)} onChange={() => toggle(ads, setAds, a.id)} />
                <Icon name="campaign" className="text-[17px] text-cyan" />
                <span className="flex-1 truncate font-medium">{a.name}</span>
                <span className="text-[12px] text-muted">{a.currency}{a.active ? "" : " · inactif"}</span>
              </label>
            ))}
          </div>
          <button onClick={save} className="mt-4 w-full rounded-lg bg-accent-strong text-white h-10 text-[13px] font-semibold">
            {saved ? "Enregistré ✓" : "Enregistrer la sélection"}
          </button>
        </>
      )}
    </div>
  );
}
