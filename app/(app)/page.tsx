import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import VoiceHero from "@/components/VoiceHero";
import HomeStats from "@/components/HomeStats";
import WelcomeClock from "@/components/WelcomeClock";
import ProjectChips from "@/components/ProjectChips";
import { Icon } from "@/components/ui";
import { describeProjectRelations, getProjectContext, PROJECT_COOKIE } from "@/lib/projects";
import { resolveTimezone, TZ_COOKIE } from "@/lib/timezone";

export const dynamic = "force-dynamic";

const BRIEFING = "Fais-moi mon briefing du jour : agenda, mails importants et tâches. Termine par les 3 priorités.";
const GLOBAL_ANALYSIS = "Analyse globale : état actuel, problèmes détectés, priorités et actions proposées.";

const MEMORY_ICONS: Record<string, string> = {
  projet: "apartment",
  objectif: "flag",
  regle: "gavel",
  seuil: "speed",
  preference: "tune",
  decision: "fact_check",
  apprentissage: "lightbulb",
};

export default async function HomePage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const { current, all } = await getProjectContext(supabase, cookieStore.get(PROJECT_COOKIE)?.value);
  const timeZone = await resolveTimezone(supabase, cookieStore.get(TZ_COOKIE)?.value);
  const pid = current?.id ?? null;
  // Toutes les données de l'accueil sont celles du projet actif (ou de l'espace général).
  const filesQ = supabase.from("files").select("id", { count: "exact", head: true });
  const memQ = supabase.from("memories").select("id, category, content").eq("active", true).order("created_at");
  const convQ = supabase.from("conversations").select("id, title, updated_at", { count: "exact" }).order("updated_at", { ascending: false }).limit(5);

  const [files, memories, convs, integrations] = await Promise.all([
    pid ? filesQ.eq("project_id", pid) : filesQ.is("project_id", null),
    pid ? memQ.or(`project_id.is.null,project_id.eq.${pid}`) : memQ.is("project_id", null),
    pid ? convQ.eq("project_id", pid) : convQ.is("project_id", null),
    supabase.from("integrations").select("provider, account_email"),
  ]);
  const google = { data: (integrations.data ?? []).filter((i) => i.provider === "google") };
  const metaConnected = (integrations.data ?? []).some((i) => i.provider === "meta");

  const mems = memories.data ?? [];
  const workspace = current?.name ?? "Espace général";
  const relations = current ? describeProjectRelations(current, all) : "";
  const rules = mems.filter((m) => ["regle", "seuil", "objectif"].includes(m.category)).slice(0, 4);
  const googleAccounts = (google.data ?? []).map((g) => g.account_email as string);
  const { data: auth } = await supabase.auth.getUser();
  const userName = String(auth.user?.user_metadata?.name ?? "").trim() || "Mario";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-5 space-y-6">
        {/* Bienvenue + heure en temps réel */}
        <WelcomeClock name={userName} />

        {/* Choix du projet */}
        <ProjectChips projects={all.map((p) => ({ id: p.id, name: p.name }))} currentId={pid} />

        {/* Espace de travail actif */}
        <section className="card is-active p-4 bg-gradient-to-br from-soft to-panel">
          <div className="flex items-center gap-3">
            <span className="grid place-items-center size-11 rounded-xl bg-accent-soft shrink-0">
              <Icon name={current ? "folder_open" : "public"} filled className="text-[22px] text-accent-text" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="label-caps text-muted">Espace de travail</div>
              <div className="text-[20px] font-bold tracking-tight truncate text-holo">{workspace}</div>
              <p className="text-[12px] text-muted truncate">
                {current?.description || (current ? "Projet" : "Mémoire commune à tous les projets")}
                {relations && <span className="text-cyan"> · {relations}</span>}
              </p>
            </div>
            <span className="rounded border border-cyan/40 text-cyan px-1.5 h-5 inline-flex items-center gap-1 text-[10px] font-bold tracking-[0.08em] uppercase shrink-0">
              <span className="size-1.5 rounded-full bg-cyan animate-ping" /> En ligne
            </span>
          </div>
        </section>

        {/* Statistiques animées */}
        <HomeStats
          stats={[
            { label: "Analyses", value: convs.count ?? 0, icon: "forum", href: "/chat" },
            { label: "Fichiers", value: files.count ?? 0, icon: "folder_open", href: "/fichiers" },
            { label: "Mémoires", value: mems.length, icon: "memory", href: "/memoire" },
            {
              label: "Connexions",
              value: googleAccounts.length + (metaConnected ? 1 : 0),
              icon: "hub",
              href: "/connexions",
              hint: [googleAccounts.length ? "Google" : "", metaConnected ? "Meta" : ""].filter(Boolean).join(" · ") || "Aucune",
            },
          ]}
        />

        {/* Parler à l'IA */}
        <VoiceHero />

        {/* Pulse : briefing */}
        <section className="card p-4" style={{ ["--i" as string]: 2 }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold">
              <span className="grid place-items-center size-7 rounded-lg bg-accent-strong text-white">
                <Icon name="monitoring" className="text-[17px]" />
              </span>
              MARKOVA Pulse
            </div>
            <span className="rounded border border-cyan/40 bg-cyan-soft text-cyan px-2 h-6 inline-flex items-center gap-1 text-[11px] font-semibold">
              <span className="size-1.5 rounded-full bg-cyan" /> {googleAccounts.length ? "Agenda · Mails · Tâches" : "Mémoire · Fichiers"}
            </span>
          </div>
          <p className="mt-3 text-[20px] font-semibold leading-snug tracking-tight">
            {googleAccounts.length ? (
              <>Ton <span className="text-accent-text underline underline-offset-4 decoration-accent/60">briefing du jour</span> : rendez-vous, mails à traiter, tâches en retard et priorités.</>
            ) : (
              <>Connecte Google pour un <span className="text-accent-text">briefing du jour</span> avec ton agenda, tes mails et tes tâches.</>
            )}
          </p>
          <div className="mt-4 flex gap-2">
            {googleAccounts.length ? (
              <Link
                href={`/chat?q=${encodeURIComponent(BRIEFING)}&send=1`}
                className="flex-1 rounded-lg bg-accent-strong text-white h-11 inline-flex items-center justify-center gap-1.5 text-[14px] font-semibold pulse-glow shine"
              >
                Lancer le briefing <Icon name="arrow_forward" className="text-[18px]" />
              </Link>
            ) : (
              <Link href="/connexions" className="flex-1 rounded-lg bg-accent-strong text-white h-11 inline-flex items-center justify-center gap-1.5 text-[14px] font-semibold glow">
                Connecter Google <Icon name="arrow_forward" className="text-[18px]" />
              </Link>
            )}
            <Link
              href={`/chat?q=${encodeURIComponent(GLOBAL_ANALYSIS)}&send=1`}
              className="rounded-lg border border-line bg-soft h-11 px-3 inline-flex items-center gap-1.5 text-[13px] font-semibold"
              title="État actuel, problèmes détectés, priorités et actions proposées, à partir de toutes les sources connectées"
            >
              <Icon name="query_stats" className="text-[18px] text-cyan" /> Analyse globale
            </Link>
          </div>
        </section>

        {/* Mémoire active */}
        <section className="card p-4" style={{ ["--i" as string]: 3 }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="label-caps flex items-center gap-1.5">
              <Icon name="psychology" className="text-[17px] text-cyan" /> Mémoire active
            </h2>
            <Link href="/memoire" className="text-[11px] text-muted font-medium hover:text-ink">Règles permanentes →</Link>
          </div>
          {rules.length ? (
            <ul className="space-y-2">
              {rules.map((r) => (
                <li key={r.id} className="flex gap-2.5 rounded-lg bg-soft/60 border border-[var(--hairline)] px-3 py-2.5 text-[13px]">
                  <Icon name={MEMORY_ICONS[r.category] ?? "bookmark"} className="text-[17px] text-muted mt-px" />
                  <span className="leading-snug">{r.content}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">
              Aucune règle enregistrée. Décris ton projet, tes objectifs et tes seuils (CPL max, budget…) dans{" "}
              <Link href="/memoire" className="text-accent-text underline">Mémoire</Link> : MARKOVA sera bien plus précis.
            </p>
          )}
        </section>

        {/* Conversations récentes */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="label-caps">Analyses récentes</h2>
            <Link href="/chat" className="text-[11px] text-accent-text font-semibold">Nouvelle →</Link>
          </div>
          <div className="space-y-2">
            {(convs.data ?? []).length === 0 && <p className="text-[13px] text-muted">Aucune analyse pour l'instant.</p>}
            {(convs.data ?? []).map((c, i) => (
              <Link key={c.id} href={`/c/${c.id}`} className="card flex items-center gap-3 px-3 py-2.5 hover:bg-soft" style={{ ["--i" as string]: i + 4 }}>
                <span className="grid place-items-center size-9 rounded-lg bg-soft border border-line">
                  <Icon name="forum" className="text-[18px] text-muted" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[14px] font-semibold">{c.title}</span>
                  <span className="block text-[12px] text-muted">
                    {new Date(c.updated_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone })}
                  </span>
                </span>
                <Icon name="chevron_right" className="text-muted" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
