import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getProjectContext, PROJECT_COOKIE } from "@/lib/projects";
import { resolveTimezone, TZ_COOKIE } from "@/lib/timezone";
import { Icon } from "@/components/ui";
import ProjectSwitcher from "@/components/ProjectSwitcher";
import AddFileButton from "./AddFileButton";
import OpenProjectButton from "./OpenProjectButton";

export const dynamic = "force-dynamic";

const GLOBAL_ANALYSIS = "Analyse globale : état actuel, problèmes détectés, priorités et actions proposées.";

const CATEGORY_LABELS: Record<string, string> = {
  projet: "🏢 Projet",
  objectif: "🎯 Objectif",
  regle: "📏 Règle",
  seuil: "📊 Seuil",
  preference: "⚙️ Préférence",
  decision: "🗂️ Décision",
  apprentissage: "💡 Appris",
};

/** « Mon projet » : tout le projet au même endroit (discussions, fichiers, mémoire, étude, veille). */
export default async function ProjectHubPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const { current, all } = await getProjectContext(supabase, cookieStore.get(PROJECT_COOKIE)?.value);
  const timeZone = await resolveTimezone(supabase, cookieStore.get(TZ_COOKIE)?.value);
  const pid = current?.id ?? null;

  // Tout est filtré sur le projet en cours (ou, sans projet, sur ce qui n'appartient à aucun projet).
  const convQ = supabase.from("conversations").select("id, title, updated_at", { count: "exact" }).order("updated_at", { ascending: false }).limit(6);
  const fileQ = supabase.from("files").select("id, name, kind, created_at", { count: "exact" }).order("created_at", { ascending: false }).limit(6);
  const memQ = supabase.from("memories").select("id, category, content", { count: "exact" }).eq("active", true).order("created_at", { ascending: false }).limit(6);
  const [convs, files, mems, studies, comps, extra] = await Promise.all([
    pid ? convQ.eq("project_id", pid) : convQ.is("project_id", null),
    pid ? fileQ.eq("project_id", pid) : fileQ.is("project_id", null),
    pid ? memQ.eq("project_id", pid) : memQ.is("project_id", null),
    pid
      ? supabase.from("market_studies").select("id, market, country, region, status, validated_at, created_at").eq("project_id", pid).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; market: string; country: string; region: string | null; status: string; validated_at: string | null; created_at: string }[] }),
    pid ? supabase.from("competitors").select("id", { count: "exact", head: true }).eq("project_id", pid).eq("active", true) : Promise.resolve({ count: 0 }),
    pid ? supabase.from("projects").select("brand_voice").eq("id", pid).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const latestStudies = (studies.data ?? []).filter((s, i, list) => list.findIndex((x) => x.country === s.country && (x.region ?? "") === (s.region ?? "")) === i);
  const brandVoice = (extra.data as { brand_voice?: string | null } | null)?.brand_voice ?? null;
  const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });

  const actions = [
    { href: "/", icon: "edit_square", label: "Nouvelle discussion", hint: "Parler ou écrire à Kimia", color: "#818cf8" },
    { href: `/?q=${encodeURIComponent(GLOBAL_ANALYSIS)}&send=1`, icon: "query_stats", label: "Analyse globale", hint: "Où j'en suis, quoi faire", color: "#22d3ee" },
    { href: "/marche", icon: "travel_explore", label: "Étude de marché", hint: "Cibles, besoins, mots-clés", color: "#4ade80" },
    { href: "/veille", icon: "radar", label: "Veille concurrents", hint: `${comps.count ?? 0} suivi(s)`, color: "#fb7185" },
    { href: "/memoire", icon: "psychology", label: "Ce que Kimia retient", hint: `${mems.count ?? 0} élément(s)`, color: "#c084fc" },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
        {/* En-tête du projet */}
        <section className="card p-5 bg-gradient-to-br from-soft to-panel">
          <div className="flex items-start gap-4">
            <span className="grid place-items-center size-14 rounded-2xl bg-accent-strong text-white text-[24px] font-extrabold shrink-0">
              {current ? current.name.slice(0, 1).toUpperCase() : <Icon name="public" className="text-[28px]" />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-muted">Projet en cours</div>
              <h1 className="page-title truncate">{current?.name ?? "Espace général"}</h1>
              <p className="page-sub">
                {current?.description || (current ? "Ajoute une description pour que Kimia comprenne mieux ce projet." : "Ce qui n'appartient à aucun projet. Crée un projet par marque ou par client.")}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <div className="w-full sm:w-64">
              <ProjectSwitcher />
            </div>
            <Link href="/projets" className="btn btn-sm">
              <Icon name="edit" className="text-[18px]" /> {current ? "Modifier le projet" : "Gérer mes projets"}
            </Link>
          </div>
        </section>

        {/* Actions principales : grandes tuiles */}
        <section className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {actions.map((a) => (
            <Link key={a.label} href={a.href} className="card p-4 hover:bg-soft transition-colors flex flex-col gap-2 min-h-[112px]">
              <span className="grid place-items-center size-11 rounded-xl" style={{ background: `${a.color}22` }}>
                <Icon name={a.icon} filled className="text-[24px]" style={{ color: a.color }} />
              </span>
              <span className="text-[16px] font-bold leading-tight">{a.label}</span>
              <span className="text-[13px] text-muted leading-snug">{a.hint}</span>
            </Link>
          ))}
          <AddFileButton />
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Discussions */}
          <Block title="💬 Discussions" count={convs.count ?? 0}>
            {(convs.data ?? []).length === 0 && <Empty>Aucune discussion pour l&apos;instant.</Empty>}
            {(convs.data ?? []).map((c) => (
              <Row key={c.id} href={`/c/${c.id}`} icon="forum" title={c.title} sub={when(c.updated_at)} />
            ))}
            <Link href="/" className="mt-1 flex items-center gap-2 rounded-xl border border-dashed border-line px-3 h-11 text-[15px] font-semibold text-accent-text hover:bg-soft">
              <Icon name="add" className="text-[20px]" /> Nouvelle discussion
            </Link>
          </Block>

          {/* Fichiers */}
          <Block title="📎 Fichiers" count={files.count ?? 0} more={{ href: "/fichiers", label: "Tout voir" }}>
            {(files.data ?? []).length === 0 && <Empty>Aucun fichier. Ajoute ta fiche produit, tes tarifs ou tes exports : Kimia s&apos;en servira.</Empty>}
            {(files.data ?? []).map((f) => (
              <Row key={f.id} href={`/?files=${f.id}`} icon="description" title={f.name} sub={`${f.kind} · ${when(f.created_at)}`} />
            ))}
          </Block>

          {/* Mémoire */}
          <Block title="🧠 Ce que Kimia retient" count={mems.count ?? 0} more={{ href: "/memoire", label: "Tout voir" }}>
            {(mems.data ?? []).length === 0 && <Empty>Rien encore. Dis à Kimia « mémorise ça » après lui avoir décrit ton offre.</Empty>}
            {(mems.data ?? []).map((m) => (
              <div key={m.id} className="rounded-xl bg-soft/60 border border-[var(--hairline)] px-3 py-2.5 text-[14px] leading-snug">
                <span className="text-[12px] font-semibold text-muted">{CATEGORY_LABELS[m.category] ?? m.category}</span>
                <div className="line-clamp-2">{m.content}</div>
              </div>
            ))}
          </Block>

          {/* Étude de marché + voix de marque */}
          <Block title="🧭 Marché et marque" more={{ href: "/marche", label: "Ouvrir" }}>
            {!pid && <Empty>Choisis un projet pour faire son étude de marché.</Empty>}
            {pid && latestStudies.length === 0 && <Empty>Aucune étude de marché. Ouvre « Étude de marché » ou dis à Kimia : « Fais l&apos;étude de marché pour le Québec ».</Empty>}
            {latestStudies.map((s) => (
              <Row
                key={s.id}
                href={`/marche?etude=${s.id}`}
                icon="public"
                title={s.market}
                sub={s.status !== "terminee" ? "⏳ en cours" : s.validated_at ? "✅ validée — utilisée par Kimia" : "⏳ à relire et valider"}
              />
            ))}
            {pid && (
              <Row
                href="/projets"
                icon="record_voice_over"
                title="Voix de marque"
                sub={brandVoice ? "✅ définie — appliquée à tous les contenus" : "pas encore définie — dis « crée la voix de marque »"}
              />
            )}
          </Block>
        </div>

        {/* Autres projets */}
        {all.length > 1 && (
          <section>
            <h2 className="text-[17px] font-bold mb-2.5">📁 Mes autres projets</h2>
            <div className="flex flex-wrap gap-2">
              {all
                .filter((p) => p.id !== pid)
                .map((p) => (
                  <OpenProjectButton key={p.id} id={p.id} name={p.name} />
                ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Block({ title, count, more, children }: { title: string; count?: number; more?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[17px] font-bold">
          {title}
          {count !== undefined && <span className="ml-1.5 text-[14px] font-semibold text-muted tabular">{count}</span>}
        </h2>
        {more && (
          <Link href={more.href} className="text-[14px] font-semibold text-accent-text">
            {more.label} →
          </Link>
        )}
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Row({ href, icon, title, sub }: { href: string; icon: string; title: string; sub: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-soft">
      <span className="grid place-items-center size-10 rounded-xl bg-soft border border-line shrink-0">
        <Icon name={icon} className="text-[20px] text-muted" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block truncate text-[15px] font-semibold">{title}</span>
        <span className="block text-[13px] text-muted truncate">{sub}</span>
      </span>
      <Icon name="chevron_right" className="text-muted" />
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] text-muted px-1 py-1 leading-snug">{children}</p>;
}
