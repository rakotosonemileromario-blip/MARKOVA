"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProjectId } from "@/lib/project-client";
import { countryName, STEP_LABELS, STEPS, type Market, type Step } from "@/lib/market-shared";
import Markdown from "@/components/Markdown";
import { Icon } from "@/components/ui";

type Project = { id: string; name: string };
type Study = {
  id: string; project_id: string; market: string; country: string; region: string | null; language: string;
  sections: Partial<Record<Step, string>>; sources: { title: string; url: string }[];
  status: "en_attente" | "en_cours" | "terminee" | "erreur"; error: string | null; started_at: string | null; created_at: string; updated_at: string;
};

const VISIBLE = STEPS.filter((s) => s !== "plan");
const LANGS = [
  ["fr", "Français"], ["en", "Anglais"], ["es", "Espagnol"], ["pt", "Portugais"], ["de", "Allemand"], ["it", "Italien"],
  ["nl", "Néerlandais"], ["ar", "Arabe"], ["mg", "Malgache"], ["zh", "Chinois"], ["ja", "Japonais"],
] as const;

/** Tous les pays connus du navigateur (codes ISO à 2 lettres), triés par nom. */
function allCountries() {
  const out: { code: string; name: string }[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const name = countryName(code);
      if (name && name !== code && !/inconnue|unknown/i.test(name)) out.push({ code, name });
    }
  }
  return out.sort((x, y) => x.name.localeCompare(y.name, "fr"));
}

const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

export default function MarketBoard() {
  const params = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [studies, setStudies] = useState<Study[] | null>(null);
  const [selected, setSelected] = useState<string | null>(params.get("etude"));
  const [tab, setTab] = useState<Step>("synthese");
  const [launching, setLaunching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [setupError, setSetupError] = useState(false);
  const resumed = useRef<Record<string, number>>({});

  const load = useCallback(async (pid: string | null) => {
    if (!pid) return;
    const supabase = createClient();
    const [m, s] = await Promise.all([
      supabase.from("projects").select("markets").eq("id", pid).maybeSingle(),
      supabase
        .from("market_studies")
        .select("id, project_id, market, country, region, language, sections, sources, status, error, started_at, created_at, updated_at")
        .eq("project_id", pid)
        .order("created_at", { ascending: false }),
    ]);
    if (s.error) {
      setSetupError(true);
      setStudies([]);
      return;
    }
    setMarkets(((m.data?.markets as Market[]) ?? []) || []);
    setStudies((s.data ?? []) as Study[]);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await createClient().from("projects").select("id, name").order("name");
      setProjects(data ?? []);
      const pid = getCurrentProjectId() ?? data?.[0]?.id ?? null;
      setProjectId(pid);
      load(pid);
    })();
  }, [load]);

  // Une seule étude par marché : la plus récente.
  const latest = useMemo(() => {
    const out: Study[] = [];
    for (const s of studies ?? []) if (!out.some((o) => o.country === s.country && (o.region ?? "") === (s.region ?? ""))) out.push(s);
    return out;
  }, [studies]);
  const current = latest.find((s) => s.id === selected) ?? (studies ?? []).find((s) => s.id === selected) ?? latest[0] ?? null;
  const running = (studies ?? []).filter((s) => s.status === "en_cours" || s.status === "en_attente");

  // Suivi en direct ; une étude arrêtée en route (délai dépassé) est relancée depuis la page.
  useEffect(() => {
    if (!running.length) return;
    const t = setInterval(() => load(projectId), 5000);
    for (const s of running) {
      const idle = Date.now() - new Date(s.updated_at).getTime();
      const stuck = s.status === "en_attente" ? idle > 20_000 : idle > 6.5 * 60_000;
      if (stuck && Date.now() - (resumed.current[s.id] ?? 0) > 90_000) {
        resumed.current[s.id] = Date.now();
        fetch("/api/etude", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reprendre", id: s.id }) })
          .then(() => load(projectId))
          .catch(() => {});
      }
    }
    return () => clearInterval(t);
  }, [running, projectId, load]);

  async function launch(fields: Record<string, unknown>) {
    setMessage(null);
    const res = await fetch("/api/etude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "lancer", projectId, ...fields }),
    });
    const json = await res.json().catch(() => ({}));
    setMessage(json.text ?? json.error ?? null);
    setLaunching(false);
    setSelected(null);
    load(projectId);
  }

  const project = projects.find((p) => p.id === projectId);
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[24px] font-bold tracking-tight">Étude de marché</h1>
            <p className="text-[13px] text-muted mt-0.5">Une étude par marché : cibles, besoins, PESTEL, mots-clés Google du pays, sujets.</p>
          </div>
          {!setupError && projectId && (
            <button
              onClick={() => setLaunching((x) => !x)}
              className="shrink-0 rounded-lg bg-accent-strong text-white h-10 px-3.5 inline-flex items-center gap-1.5 text-[13px] font-semibold glow"
            >
              <Icon name="add" className="text-[18px]" /> Étude
            </button>
          )}
        </div>

        {projects.length > 1 && (
          <select
            value={projectId ?? ""}
            onChange={(e) => {
              setProjectId(e.target.value);
              setSelected(null);
              load(e.target.value);
            }}
            className="mt-4 w-full h-10 rounded-lg border border-line bg-soft px-3 text-[14px] outline-none focus:border-accent"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                Projet : {p.name}
              </option>
            ))}
          </select>
        )}

        {!projects.length && <p className="mt-6 text-[13px] text-muted">Crée d&apos;abord un projet : l&apos;étude de marché se fait par projet.</p>}
        {setupError && (
          <div className="card mt-4 p-4 text-[14px]">⚠️ La base n&apos;est pas encore à jour : relance supabase/schema.sql dans Supabase (SQL Editor → coller → Run), puis recharge la page.</div>
        )}
        {launching && project && <LaunchForm project={project.name} markets={markets} onLaunch={launch} onCancel={() => setLaunching(false)} />}
        {message && <div className="card mt-4 p-3 text-[13px]">{message}</div>}

        {/* Marchés : un onglet par marché étudié, plus les marchés déclarés sans étude. */}
        {studies && !setupError && (
          <div className="mt-4 flex flex-wrap gap-2">
            {latest.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s.id)}
                className={`rounded-full border h-9 px-3 text-[13px] font-semibold inline-flex items-center gap-1.5 ${current?.id === s.id ? "border-accent bg-accent-soft text-accent-text" : "border-line"}`}
              >
                {s.status === "terminee" ? "🌍" : s.status === "erreur" ? "⚠️" : "⏳"} {s.market}
              </button>
            ))}
            {markets
              .filter((m) => !latest.some((s) => s.country === m.country && (s.region ?? "") === (m.region ?? "")))
              .map((m) => (
                <button
                  key={`${m.country}-${m.region ?? ""}`}
                  onClick={() => launch({ pays: m.country, region: m.region ?? "", langue: m.language, libelle: m.label, pages: m.pages ?? [] })}
                  className="rounded-full border border-dashed border-line h-9 px-3 text-[13px] text-muted inline-flex items-center gap-1.5"
                  title="Lancer l'étude de ce marché"
                >
                  <Icon name="add" className="text-[16px]" /> {m.label}
                </button>
              ))}
          </div>
        )}

        {studies?.length === 0 && !setupError && projectId && !launching && (
          <p className="mt-6 text-[13px] text-muted">
            Aucune étude pour ce projet. Lance-en une avec « Étude », ou dis à MARKOVA : « Fais l&apos;étude de marché de ce projet pour le Québec ».
          </p>
        )}

        {current && <StudyView study={current} tab={tab} setTab={setTab} />}
      </div>
    </div>
  );
}

function StudyView({ study, tab, setTab }: { study: Study; tab: Step; setTab: (s: Step) => void }) {
  const doneCount = VISIBLE.filter((s) => study.sections[s]).length;
  const active = study.sections[tab] ? tab : (VISIBLE.find((s) => study.sections[s]) ?? tab);
  return (
    <div className="card mt-4 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
        <span className="font-semibold text-[15px] text-ink">{study.market}</span>
        <span>pays {study.country}{study.region ? ` · ${study.region}` : ""} · langue {study.language}</span>
        <span>{day(study.created_at)}</span>
      </div>

      {study.status !== "terminee" && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[12px]">
            <span>
              {study.status === "erreur" ? `⚠️ Arrêtée : ${study.error ?? "erreur"}` : `⏳ En cours : ${STEP_LABELS[STEPS.find((s) => !study.sections[s]) ?? "synthese"]}…`}
            </span>
            <span className="text-muted">
              {doneCount}/{VISIBLE.length}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-soft overflow-hidden">
            <div className="h-full bg-accent-strong transition-all" style={{ width: `${(doneCount / VISIBLE.length) * 100}%` }} />
          </div>
          {study.status === "erreur" && (
            <button
              onClick={() =>
                fetch("/api/etude", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reprendre", id: study.id }) }).then(() =>
                  window.location.reload(),
                )
              }
              className="mt-2 rounded-lg border border-line h-9 px-3 text-[13px] font-semibold"
            >
              Reprendre l&apos;étude
            </button>
          )}
        </div>
      )}

      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
        {VISIBLE.map((s) => (
          <button
            key={s}
            disabled={!study.sections[s]}
            onClick={() => setTab(s)}
            className={`shrink-0 rounded-lg h-8 px-2.5 text-[12px] font-semibold disabled:opacity-40 ${active === s ? "bg-accent-strong text-white" : "bg-soft border border-line"}`}
          >
            {STEP_LABELS[s]}
          </button>
        ))}
      </div>

      {study.sections[active] ? (
        <div className="mt-3 text-[14px] leading-relaxed">
          <Markdown>{study.sections[active]!}</Markdown>
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-muted">Cette partie arrive…</p>
      )}

      {study.sources.length > 0 && (
        <details className="mt-4 text-[12px]">
          <summary className="cursor-pointer text-muted">{study.sources.length} sources consultées</summary>
          <ul className="mt-2 space-y-1">
            {study.sources.map((s) => (
              <li key={s.url} className="truncate">
                <a href={s.url} target="_blank" rel="noreferrer" className="text-cyan">
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function LaunchForm({
  project,
  markets,
  onLaunch,
  onCancel,
}: {
  project: string;
  markets: Market[];
  onLaunch: (fields: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const countries = useMemo(allCountries, []);
  const [country, setCountry] = useState(markets[0]?.country ?? "MG");
  const [region, setRegion] = useState(markets[0]?.region ?? "");
  const [language, setLanguage] = useState(markets[0]?.language ?? "fr");
  const [offres, setOffres] = useState("");
  const [site, setSite] = useState("");
  const [busy, setBusy] = useState(false);
  const input = "w-full rounded-lg border border-line bg-soft px-3 text-[14px] outline-none focus:border-accent";

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const known = markets.find((m) => m.country === country && (m.region ?? "") === region.trim());
        await onLaunch({ pays: country, region: region.trim(), langue: language, offres, site, ...(known ? { libelle: known.label, pages: known.pages ?? [] } : {}) });
        setBusy(false);
      }}
      className="card mt-4 p-4 space-y-3"
    >
      <div className="font-semibold">Nouvelle étude · {project}</div>
      {markets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {markets.map((m) => (
            <button
              type="button"
              key={`${m.country}-${m.region ?? ""}`}
              onClick={() => {
                setCountry(m.country);
                setRegion(m.region ?? "");
                setLanguage(m.language);
              }}
              className="rounded-full border border-line h-8 px-3 text-[12px]"
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <select value={country} onChange={(e) => setCountry(e.target.value)} className={`${input} h-10`} aria-label="Pays">
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Région / ville (optionnel)" className={`${input} h-10`} />
        <select value={language} onChange={(e) => setLanguage(e.target.value)} className={`${input} h-10`} aria-label="Langue du marché">
          {(LANGS.some(([c]) => c === language) ? LANGS : [...LANGS, [language, language] as const]).map(([code, name]) => (
            <option key={code} value={code}>
              Langue : {name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={offres}
        onChange={(e) => setOffres(e.target.value)}
        rows={3}
        placeholder="Tes offres pour ce marché (produits, services, prix, avantages) — optionnel si la mémoire du projet ou le site les décrit"
        className={`${input} py-2`}
      />
      <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="Site ou page d'offre (optionnel)" className={`${input} h-10`} />
      <div className="flex gap-2">
        <button disabled={busy} className="flex-1 rounded-lg bg-accent-strong text-white h-10 text-[13px] font-semibold disabled:opacity-50">
          {busy ? "Lancement…" : "Lancer l'étude (2 à 5 min)"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-line h-10 px-4 text-[13px] font-semibold">
          Annuler
        </button>
      </div>
    </form>
  );
}
