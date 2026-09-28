"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "./ui";

export type ActionItem = {
  id: string;
  kind: string;
  account_email: string | null;
  summary: string;
  reason: string | null;
  status: string;
  result?: string | null;
};

const KIND_ICONS: Record<string, string> = {
  tache_supprimer: "delete",
  tache_terminer: "task_alt",
  tache_creer: "add_task",
  meta_pause: "pause_circle",
  meta_activer: "play_circle",
  meta_budget: "payments",
};

const STATUS: Record<string, { label: string; cls: string }> = {
  en_attente: { label: "À valider", cls: "bg-warn-soft text-warn" },
  executee: { label: "Fait", cls: "bg-ok-soft text-ok" },
  refusee: { label: "Refusé", cls: "bg-soft text-muted" },
  erreur: { label: "Échec", cls: "bg-danger-soft text-danger" },
};

/** Actions proposées par l'agent : rien n'est exécuté avant un clic sur « Confirmer ». */
export default function ActionCards({ actions: initial }: { actions: ActionItem[] }) {
  const [actions, setActions] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setActions((cur) => mergeNew(cur, initial)), [initial]);

  // Statut à jour (utile en rouvrant une ancienne conversation, ou depuis un autre appareil).
  useEffect(() => {
    const ids = initial.map((a) => a.id);
    if (!ids.length) return;
    createClient()
      .from("actions")
      .select("id, status, result")
      .in("id", ids)
      .then(({ data }) => {
        if (!data) return;
        setActions((cur) => cur.map((a) => ({ ...a, ...(data.find((d) => d.id === a.id) ?? {}) })));
      });
  }, [initial.map((a) => a.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(id: string, decision: "confirmer" | "refuser") {
    setBusy(id);
    try {
      const res = await fetch(`/api/actions/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const json = await res.json();
      setActions((cur) => cur.map((a) => (a.id === id ? { ...a, status: json.status ?? "erreur", result: json.result ?? json.error } : a)));
    } finally {
      setBusy(null);
    }
  }

  async function confirmAll() {
    for (const a of actions.filter((x) => x.status === "en_attente")) await decide(a.id, "confirmer");
  }

  if (!actions.length) return null;
  const pending = actions.filter((a) => a.status === "en_attente").length;

  return (
    <div className="mt-4 rounded-xl border border-warn/40 bg-warn-soft/40 p-3">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className="label-caps text-warn flex items-center gap-1.5">
          <Icon name="lock" className="text-[15px]" /> Actions à valider
        </span>
        {pending > 1 && (
          <button
            onClick={confirmAll}
            disabled={!!busy}
            className="rounded-lg bg-accent-strong text-white h-8 px-3 text-[12px] font-semibold disabled:opacity-50"
          >
            Tout confirmer ({pending})
          </button>
        )}
      </div>
      <div className="space-y-2">
        {actions.map((a) => {
          const st = STATUS[a.status] ?? STATUS.erreur;
          return (
            <div key={a.id} className="rounded-lg bg-panel border border-line p-3">
              <div className="flex items-start gap-2.5">
                <Icon name={KIND_ICONS[a.kind] ?? "bolt"} className="text-[19px] text-muted mt-px" />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold leading-snug">{a.summary}</div>
                  <div className="text-[12px] text-muted mt-0.5">
                    {a.account_email}
                    {a.reason ? ` · ${a.reason}` : ""}
                  </div>
                  {a.result && a.status !== "en_attente" && (
                    <div className={`text-[12px] mt-1 ${a.status === "erreur" ? "text-danger" : "text-muted"}`}>{a.result}</div>
                  )}
                </div>
                <span className={`tag ${st.cls} !mr-0`}>{st.label}</span>
              </div>
              {a.status === "en_attente" && (
                <div className="mt-2.5 flex gap-2">
                  <button
                    onClick={() => decide(a.id, "confirmer")}
                    disabled={!!busy}
                    className="flex-1 rounded-lg bg-accent-strong text-white h-9 text-[13px] font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-50"
                  >
                    <Icon name="check" className="text-[17px]" />
                    {busy === a.id ? "…" : "Confirmer"}
                  </button>
                  <button
                    onClick={() => decide(a.id, "refuser")}
                    disabled={!!busy}
                    className="rounded-lg border border-line h-9 px-3 text-[13px] font-semibold text-muted hover:text-ink disabled:opacity-50"
                  >
                    Refuser
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function mergeNew(cur: ActionItem[], incoming: ActionItem[]) {
  const known = new Set(cur.map((a) => a.id));
  return [...cur, ...incoming.filter((a) => !known.has(a.id))];
}
