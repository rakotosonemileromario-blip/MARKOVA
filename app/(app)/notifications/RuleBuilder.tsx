"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui";
import { describeRule, METRICS, PERIODS, SOURCES, type Source } from "@/lib/watch-rules";
import { validateRule, type NewRule } from "@/lib/watch-tools";

type Choice = { operator: ">" | "<"; threshold: string };

const CHIP_TONES = ["#facc15", "#c084fc", "#4ade80", "#fb7185", "#60a5fa"];

/** Création de règles : plusieurs métriques à la fois, chacune avec son seuil, sur plusieurs pages / campagnes. */
export default function RuleBuilder({ accounts, onDone }: { accounts: { facebook: string[]; instagram: string[] }; onDone: (msg: string, ok: boolean) => void }) {
  const [source, setSource] = useState<Source>("ads");
  const [picked, setPicked] = useState<Record<string, Choice>>({});
  const [period, setPeriod] = useState("last_7d");
  const [aggregation, setAggregation] = useState<"total" | "publication">("total");
  const [targets, setTargets] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const metrics = Object.entries(METRICS).filter(([, m]) => m.sources.includes(source));
  const options = source === "facebook" ? accounts.facebook : source === "instagram" ? accounts.instagram : [];

  function changeSource(s: Source) {
    setSource(s);
    setPicked({});
    setTargets([]);
  }

  function toggleMetric(k: string) {
    setPicked((p) => {
      const next = { ...p };
      if (next[k]) delete next[k];
      else next[k] = { operator: k === "ctr" || k === "roas" || k === "leads" || k === "publications" ? "<" : ">", threshold: "" };
      return next;
    });
  }

  const toggleTarget = (t: string) => setTargets((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]));

  function addDraft() {
    const parts = draft.split(",").map((x) => x.trim()).filter(Boolean);
    if (parts.length) setTargets((xs) => [...new Set([...xs, ...parts])]);
    setDraft("");
  }

  async function save() {
    const entries = Object.entries(picked);
    if (!entries.length) return onDone("Choisis au moins un indicateur.", false);
    const rules: NewRule[] = [];
    for (const [metric, c] of entries) {
      const threshold = Number(c.threshold.replace(",", "."));
      if (c.threshold.trim() === "" || !Number.isFinite(threshold)) return onDone(`Indique un seuil pour ${METRICS[metric].label}.`, false);
      const r: NewRule = { source, metric, operator: c.operator, threshold, period, scope: targets.length ? targets.join(" | ") : null, aggregation };
      const err = validateRule(r);
      if (err) return onDone(err, false);
      rules.push(r);
    }
    setBusy(true);
    const { error } = await createClient().from("watch_rules").insert(rules.map((r) => ({ ...r, label: describeRule(r) })));
    setBusy(false);
    if (error) return onDone(error.message.includes("check constraint") ? "Base de données à mettre à jour : relance supabase/schema.sql dans Supabase." : error.message, false);
    setPicked({});
    setTargets([]);
    onDone(`${rules.length} règle(s) ajoutée(s) :\n${rules.map((r) => describeRule(r)).join("\n")}`, true);
  }

  const n = Object.keys(picked).length;

  return (
    <div className="mt-4 space-y-4">
      {/* 1. Source */}
      <div>
        <div className="label-caps text-muted mb-2">1 · Quoi surveiller</div>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(SOURCES) as Source[]).map((s) => (
            <button
              key={s}
              onClick={() => changeSource(s)}
              className={`rounded-xl border h-16 px-1 text-[12px] font-semibold flex flex-col items-center justify-center gap-0.5 transition-colors ${
                source === s ? "border-accent bg-accent-soft text-ink" : "border-line bg-soft text-muted"
              }`}
            >
              <span className="text-[20px] leading-none">{SOURCES[s].emoji}</span>
              <span>{{ ads: "Pubs Meta", facebook: "Facebook", instagram: "Instagram" }[s]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 2. Indicateurs (plusieurs possibles) */}
      <div>
        <div className="label-caps text-muted mb-2">2 · Indicateurs (plusieurs possibles)</div>
        <div className="flex flex-wrap gap-2">
          {metrics.map(([k, m], i) => {
            const on = Boolean(picked[k]);
            const tone = CHIP_TONES[i % CHIP_TONES.length];
            return (
              <button
                key={k}
                onClick={() => toggleMetric(k)}
                className="rounded-full border h-9 px-3 text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors"
                style={on ? { borderColor: tone, background: `${tone}22`, color: tone } : { borderColor: "var(--line)", color: "var(--muted)" }}
              >
                <span>{m.emoji}</span> {m.label}
                {on && <Icon name="check" className="text-[16px]" />}
              </button>
            );
          })}
        </div>

        {n > 0 && (
          <div className="mt-3 space-y-2">
            {Object.entries(picked).map(([k, c]) => {
              const m = METRICS[k];
              const unit = m.unit === "devise" ? "€" : m.unit === "%" ? "%" : m.unit === "x" ? "x" : "";
              return (
                <div key={k} className="rounded-xl bg-soft border border-line p-2.5 flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold min-w-[120px] flex-1">
                    {m.emoji} {m.label}
                  </span>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="grid grid-cols-2 rounded-lg border border-line overflow-hidden shrink-0">
                      {([">", "<"] as const).map((op) => (
                        <button
                          key={op}
                          onClick={() => setPicked((p) => ({ ...p, [k]: { ...p[k], operator: op } }))}
                          className={`h-9 px-2.5 text-[12px] font-semibold ${c.operator === op ? "bg-accent-strong text-white" : "text-muted"}`}
                        >
                          {op === ">" ? "↑ plus de" : "↓ moins de"}
                        </button>
                      ))}
                    </div>
                    <div className="relative flex-1 sm:w-32">
                      <input
                        value={c.threshold}
                        onChange={(e) => setPicked((p) => ({ ...p, [k]: { ...p[k], threshold: e.target.value } }))}
                        inputMode="decimal"
                        placeholder="Seuil"
                        className="w-full h-9 rounded-lg border border-line bg-panel px-3 pr-8 text-[14px] outline-none focus:border-accent"
                      />
                      {unit && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted">{unit}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Cibles */}
      <div>
        <div className="label-caps text-muted mb-2">
          3 · {source === "ads" ? "Campagnes visées" : source === "facebook" ? "Pages visées" : "Comptes visés"} <span className="normal-case tracking-normal">(aucune = toutes)</span>
        </div>
        {source === "ads" ? (
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === ",") && (e.preventDefault(), addDraft())}
              placeholder="Mot du nom de campagne, puis Entrée"
              className="flex-1 min-w-0 h-10 rounded-lg border border-line bg-soft px-3 text-[14px] outline-none focus:border-accent"
            />
            <button onClick={addDraft} className="shrink-0 rounded-lg border border-line h-10 px-3 text-[13px]">
              Ajouter
            </button>
          </div>
        ) : options.length ? null : (
          <p className="text-[12px] text-muted">Aucun compte trouvé : vérifie la connexion Meta et le choix des pages dans Connexions.</p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {[...new Set([...options, ...targets])].map((t) => {
            const on = targets.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleTarget(t)}
                className={`rounded-full border h-8 px-3 text-[12px] inline-flex items-center gap-1 max-w-full ${on ? "border-cyan bg-cyan-soft text-cyan" : "border-line text-muted"}`}
              >
                <span className="truncate">{t}</span>
                {on && <Icon name={source === "ads" ? "close" : "check"} className="text-[14px]" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Période et mode */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="label-caps text-muted">4 · Période</span>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className="mt-2 w-full h-10 rounded-lg border border-line bg-soft px-3 text-[14px] outline-none focus:border-accent">
            {Object.entries(PERIODS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {source !== "ads" && (
          <div>
            <span className="label-caps text-muted">Calcul</span>
            <div className="mt-2 grid grid-cols-2 rounded-lg border border-line overflow-hidden">
              {([
                ["total", "Total période"],
                ["publication", "Par publication"],
              ] as const).map(([k, label]) => (
                <button key={k} onClick={() => setAggregation(k)} className={`h-10 text-[13px] font-semibold ${aggregation === k ? "bg-accent-strong text-white" : "text-muted"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={save}
        disabled={busy || !n}
        className="w-full rounded-xl bg-gradient-to-r from-accent-strong to-accent text-white h-12 text-[14px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <Icon name="add_alert" className="text-[19px]" />
        {n ? `Ajouter ${n} règle${n > 1 ? "s" : ""}` : "Choisis au moins un indicateur"}
      </button>
    </div>
  );
}
