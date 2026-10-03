"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Change, Facts } from "@/lib/veille";
import { Icon } from "@/components/ui";

export type CompetitorView = {
  id: string;
  name: string;
  notes: string | null;
  pages: { url: string; checkedAt: string | null; facts: Facts | null }[];
  changes: (Change & { date: string; url: string })[];
};

const CHANGE_STYLE: Record<Change["type"], { emoji: string; label: string; cls: string }> = {
  prix: { emoji: "💰", label: "Prix", cls: "bg-danger-soft text-danger" },
  offre: { emoji: "🎁", label: "Offre", cls: "bg-cyan-soft text-cyan" },
  message: { emoji: "📣", label: "Message", cls: "bg-violet-soft text-violet" },
  nouveaute: { emoji: "✨", label: "Nouveauté", cls: "bg-warn-soft text-warn" },
};

const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const host = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
};

export default function VeilleBoard({ competitors, setupError }: { competitors: CompetitorView[]; setupError?: string }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function call(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setMessage(null);
    try {
      const res = await fetch("/api/veille", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (json.error) setMessage(`⚠️ ${json.error}`);
      else if (body.action === "verifier") {
        setMessage(
          `${json.pages} page(s) relue(s), ${json.inchangees} sans changement` +
            (json.changements?.length ? ` · ${json.changements.length} changement(s)` : " · aucun changement") +
            (json.erreurs?.length ? ` · ${json.erreurs.length} page(s) illisible(s) : ${json.erreurs.join(" ; ")}` : ""),
        );
      } else if (body.action === "ajouter") {
        setMessage(json.text?.split("\n")[0] ?? null);
        setAdding(false);
      }
      router.refresh();
    } catch (err) {
      setMessage(`⚠️ ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight">Veille concurrentielle</h1>
            <p className="text-[13px] text-muted mt-0.5">Pages relues chaque jour · alerte si un prix ou une offre change · synthèse chaque lundi.</p>
          </div>
          {!setupError && (
            <button
              onClick={() => setAdding((x) => !x)}
              className="shrink-0 rounded-lg bg-accent-strong text-white h-10 px-3.5 inline-flex items-center gap-1.5 text-[13px] font-semibold glow"
            >
              <Icon name="add" className="text-[18px]" /> Concurrent
            </button>
          )}
        </div>

        {setupError && <div className="card mt-4 p-4 text-[14px]">⚠️ {setupError}</div>}
        {adding && <AddForm busy={busy === "add"} onAdd={(nom, urls) => call({ action: "ajouter", nom, urls }, "add")} onCancel={() => setAdding(false)} />}
        {message && <div className="card mt-4 p-3 text-[13px]">{message}</div>}

        {!setupError && competitors.length > 0 && (
          <button
            onClick={() => call({ action: "verifier" }, "all")}
            disabled={busy !== null}
            className="mt-4 rounded-lg border border-line h-9 px-3 text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Icon name="refresh" className={`text-[17px] ${busy === "all" ? "animate-spin" : ""}`} /> Vérifier maintenant
          </button>
        )}

        {!setupError && competitors.length === 0 && (
          <p className="mt-6 text-[13px] text-muted">
            Aucun concurrent suivi. Ajoute-en un avec « Concurrent », ou dis à Kimia : « Surveille mon concurrent X » — il trouvera lui-même ses pages de prix et d'offres.
          </p>
        )}

        <div className="mt-4 space-y-3">
          {competitors.map((c) => (
            <div key={c.id} className="card p-4">
              <div className="flex items-start gap-3">
                <span className="grid place-items-center size-10 rounded-lg bg-accent-strong text-white font-bold shrink-0">{c.name.slice(0, 1).toUpperCase()}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[16px] truncate">{c.name}</div>
                  {c.notes && <div className="text-[12px] text-muted">{c.notes}</div>}
                </div>
                <button
                  onClick={() => call({ action: "verifier", id: c.id }, c.id)}
                  disabled={busy !== null}
                  className="rounded-lg border border-line h-9 px-2.5 disabled:opacity-50"
                  aria-label="Vérifier ce concurrent"
                >
                  <Icon name="refresh" className={`text-[18px] ${busy === c.id ? "animate-spin" : ""}`} />
                </button>
                <button
                  onClick={() => confirm(`Ne plus suivre « ${c.name} » ? Son historique sera supprimé.`) && call({ action: "supprimer", id: c.id }, `del-${c.id}`)}
                  disabled={busy !== null}
                  className="rounded-lg border border-line h-9 px-2.5 text-danger disabled:opacity-50"
                  aria-label="Retirer"
                >
                  <Icon name="delete" className="text-[18px]" />
                </button>
              </div>

              {c.changes.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {c.changes.map((ch, i) => {
                    const st = CHANGE_STYLE[ch.type];
                    return (
                      <div key={i} className="flex items-start gap-2 text-[13px]">
                        <span className={`tag !mr-0 shrink-0 ${st.cls}`}>
                          {st.emoji} {st.label}
                        </span>
                        <span className="flex-1">{ch.detail}</span>
                        <span className="text-[11px] text-muted shrink-0">{day(ch.date)}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 space-y-2">
                {c.pages.map((p) => (
                  <div key={p.url} className="rounded-lg bg-soft border border-line p-2.5">
                    <div className="flex items-center gap-2 text-[12px]">
                      <a href={p.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-cyan">
                        {host(p.url)}
                      </a>
                      <span className="text-muted shrink-0">{p.checkedAt ? `relevé ${day(p.checkedAt)}` : "jamais lue"}</span>
                    </div>
                    {p.facts && <FactsView facts={p.facts} />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FactsView({ facts }: { facts: Facts }) {
  const rows = [
    facts.prix.length ? { k: "💰 Prix", v: facts.prix.map((p) => `${p.produit ? `${p.produit} : ` : ""}${p.prix}`) } : null,
    facts.offres.length ? { k: "🎁 Offres", v: facts.offres } : null,
    facts.messages.length ? { k: "📣 Messages", v: facts.messages } : null,
    facts.nouveautes.length ? { k: "✨ Nouveautés", v: facts.nouveautes } : null,
  ].filter(Boolean) as { k: string; v: string[] }[];
  if (!rows.length) return <div className="mt-1.5 text-[12px] text-muted">Aucun prix ni offre visible sur cette page.</div>;
  return (
    <div className="mt-1.5 space-y-1">
      {rows.map((r) => (
        <div key={r.k} className="text-[13px]">
          <span className="font-semibold">{r.k}</span> <span className="text-muted">·</span> {r.v.join(" · ")}
        </div>
      ))}
    </div>
  );
}

function AddForm({ busy, onAdd, onCancel }: { busy: boolean; onAdd: (nom: string, urls: string[]) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [urls, setUrls] = useState("");
  const list = urls.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean);
  const input = "w-full rounded-lg border border-line bg-soft px-3 text-[14px] outline-none focus:border-accent";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && list.length) onAdd(name.trim(), list);
      }}
      className="card mt-4 p-4 space-y-3"
    >
      <div className="font-semibold">Nouveau concurrent</div>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du concurrent" className={`${input} h-10`} />
      <textarea
        value={urls}
        onChange={(e) => setUrls(e.target.value)}
        rows={3}
        placeholder={"Pages à surveiller (une par ligne) : accueil, tarifs, offres…\nex. concurrent.com\nconcurrent.com/tarifs"}
        className={`${input} py-2`}
      />
      <div className="flex gap-2">
        <button disabled={busy || !name.trim() || !list.length} className="flex-1 rounded-lg bg-accent-strong text-white h-10 text-[13px] font-semibold disabled:opacity-50">
          {busy ? "Premier relevé en cours…" : "Ajouter et faire le premier relevé"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-line h-10 px-4 text-[13px] font-semibold">
          Annuler
        </button>
      </div>
    </form>
  );
}
