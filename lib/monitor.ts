import type { SupabaseClient } from "@supabase/supabase-js";
import { getGoogleSessions, taskDeadlines, todayIn } from "./google";
import { campaignMetrics, getMetaSession, organicPosts, type CampaignMetrics, type MetaSession, type OrganicPost } from "./meta";
import { notify, type NewNotification } from "./notify";
import { describeRule, METRICS, PERIOD_DAYS, PERIODS, scopeList, type WatchRule } from "./watch-rules";

export { describeRule, METRICS, PERIODS, type WatchRule };

// Surveillance automatique : compare les données réelles aux règles de l'utilisateur et crée
// des notifications. Elle ne modifie JAMAIS rien (aucune campagne, aucune tâche).

const fmt = (v: number, d = 2) => v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Une campagne enfreint-elle la règle ? Renvoie la phrase d'alerte, ou null. */
function check(rule: WatchRule, c: CampaignMetrics): string | null {
  if (c.depenses <= 0) return null; // aucune diffusion : rien à juger
  const raw = c[rule.metric as keyof CampaignMetrics] as number | null;
  const value = rule.metric === "leads" ? (raw ?? 0) : raw; // aucune conversion = 0 lead
  const m = METRICS[rule.metric];
  const unit = m.unit === "devise" ? ` ${c.currency}` : m.unit === "%" ? " %" : m.unit === "x" ? "x" : "";
  if (value == null) {
    // CPL / CPA sans aucune conversion : alerte si la dépense dépasse déjà le seuil.
    if ((rule.metric === "cpl" || rule.metric === "cpa") && rule.operator === ">" && c.depenses > rule.threshold) {
      return `0 ${rule.metric === "cpl" ? "lead" : "achat"} pour ${fmt(c.depenses)} ${c.currency} dépensés (seuil ${m.label} ${rule.threshold}${unit})`;
    }
    return null;
  }
  const breached = rule.operator === ">" ? value > rule.threshold : value < rule.threshold;
  return breached ? `${m.label} ${fmt(value)}${unit} (seuil ${rule.operator} ${rule.threshold}${unit}) · dépenses ${fmt(c.depenses)} ${c.currency}` : null;
}

export type SurveillanceResult = { nouvelles: number; verifications: string[]; erreurs: string[] };

type OrganicMetric = "likes" | "commentaires" | "partages" | "vues";
const breached = (rule: WatchRule, v: number) => (rule.operator === ">" ? v > rule.threshold : v < rule.threshold);

/** Règles sur les réseaux sociaux : par publication, total sur la période, ou nombre de publications. */
async function checkOrganic(
  rule: WatchRule,
  meta: MetaSession,
  cache: Map<string, OrganicPost[]>,
  res: SurveillanceResult,
  push: (n: NewNotification) => Promise<void>,
  today: string,
) {
  const source = rule.source === "instagram" ? "instagram" : "facebook";
  const key = `${source}:${rule.period}`;
  if (!cache.has(key)) cache.set(key, await organicPosts(meta, source, PERIOD_DAYS[rule.period] ?? 7));
  const targets = scopeList(rule.scope).map((x) => x.normalize("NFKC").toLowerCase().replace(/^@/, ""));
  const posts = cache.get(key)!.filter((p) => !targets.length || targets.some((t) => p.account.normalize("NFKC").toLowerCase().replace(/^@/, "").includes(t)));
  const m = METRICS[rule.metric];
  const period = PERIODS[rule.period] ?? rule.period;
  const byAccount = new Map<string, OrganicPost[]>();
  for (const p of posts) byAccount.set(p.account, [...(byAccount.get(p.account) ?? []), p]);
  res.verifications.push(`${describeRule(rule)} : ${posts.length} publication(s) sur ${byAccount.size} compte(s)`);

  if (rule.metric === "publications") {
    const accounts = targets.length ? [...byAccount.keys()] : [...new Set(posts.map((p) => p.account))];
    for (const account of accounts) {
      const count = byAccount.get(account)?.length ?? 0;
      if (!breached(rule, count)) continue;
      await push({
        kind: "alerte",
        title: `${m.emoji} ${count} publication(s) : ${account}`,
        body: `${count} publication(s) ${period} (seuil ${rule.operator} ${rule.threshold}).`,
        link: `/chat?q=${encodeURIComponent(`Analyse la régularité de publication de ${account} (${count} publications ${period}). Que recommandes-tu ?`)}&send=1`,
        dedupeKey: `regle:${rule.id}:${account}:${today}`,
      });
    }
    return;
  }

  const metric = rule.metric as OrganicMetric;
  if (posts.length && posts.every((p) => p[metric] == null)) {
    res.erreurs.push(`${m.label} indisponible pour ${source === "facebook" ? "Facebook" : "Instagram"} avec les autorisations actuelles (${metric === "vues" ? "read_insights" : "pages_read_user_content"}) : reconnecte Meta « avec les statistiques ».`);
    return;
  }

  if (rule.aggregation === "publication") {
    for (const p of posts) {
      const v = p[metric];
      if (v == null || !breached(rule, v)) continue;
      await push({
        kind: "alerte",
        title: `${m.emoji} ${v} ${m.label.toLowerCase()} : ${p.account}`,
        body: `Publication du ${p.date.slice(0, 10)} « ${p.text || "sans texte"} » : ${v} ${m.label.toLowerCase()} (seuil ${rule.operator} ${rule.threshold}). ${p.link}`,
        link: `/chat?q=${encodeURIComponent(`Analyse cette publication de ${p.account} (${p.link}) : ${v} ${m.label.toLowerCase()}. Pourquoi, et que faire ?`)}&send=1`,
        dedupeKey: `regle:${rule.id}:${p.id}`,
      });
    }
    return;
  }

  for (const [account, list] of byAccount) {
    const total = list.reduce((a, p) => a + (p[metric] ?? 0), 0);
    if (!breached(rule, total)) continue;
    await push({
      kind: "alerte",
      title: `${m.emoji} ${m.label} : ${account}`,
      body: `${total} ${m.label.toLowerCase()} ${period} sur ${list.length} publication(s) (seuil ${rule.operator} ${rule.threshold}).`,
      link: `/chat?q=${encodeURIComponent(`Analyse les ${m.label.toLowerCase()} de ${account} : ${total} ${period}. Que recommandes-tu ?`)}&send=1`,
      dedupeKey: `regle:${rule.id}:${account}:${today}`,
    });
  }
}

/**
 * Lance toutes les vérifications pour un utilisateur.
 * supabase : client de l'utilisateur (bouton « Vérifier maintenant ») ou client service (tâche planifiée).
 */
export async function runSurveillance(supabase: SupabaseClient, userId: string, timezone: string): Promise<SurveillanceResult> {
  const today = todayIn(timezone);
  const res: SurveillanceResult = { nouvelles: 0, verifications: [], erreurs: [] };
  const push = async (n: NewNotification) => {
    if (await notify(supabase, userId, n)) res.nouvelles++;
  };

  // ─── 1. Règles KPI sur les campagnes Meta ──────────────────────
  const { data: rules } = await supabase.from("watch_rules").select("*").eq("user_id", userId).eq("active", true);
  const meta = await getMetaSession(supabase, userId);
  if (meta) {
    // Accès Meta bientôt expiré (connexion Facebook : 60 jours).
    if (meta.expiresAt) {
      const days = Math.ceil((new Date(meta.expiresAt).getTime() - Date.now()) / 86_400_000);
      if (days <= 7) {
        await push({
          kind: "probleme",
          title: days > 0 ? `Accès Meta : expire dans ${days} jour${days > 1 ? "s" : ""}` : "Accès Meta expiré",
          body: "Reconnecte Facebook dans Connexions pour que MARKOVA continue à lire tes campagnes.",
          link: "/connexions",
          dedupeKey: `meta-expire:${today}`,
        });
      }
    }
    if (rules?.length) {
      const cache = new Map<string, CampaignMetrics[]>();
      const organicCache = new Map<string, OrganicPost[]>();
      for (const rule of rules as WatchRule[]) {
        if ((rule.source ?? "ads") !== "ads") {
          try {
            await checkOrganic(rule, meta, organicCache, res, push, today);
          } catch (err) {
            res.erreurs.push(`${rule.source === "instagram" ? "Instagram" : "Facebook"} : ${err instanceof Error ? err.message : err}`);
          }
          continue;
        }
        try {
          if (!cache.has(rule.period)) cache.set(rule.period, await campaignMetrics(meta, rule.period));
          const targets = scopeList(rule.scope).map((x) => x.toLowerCase());
          const campaigns = cache.get(rule.period)!.filter(
            (c) => c.status === "ACTIVE" && (!targets.length || targets.some((t) => c.name.toLowerCase().includes(t))),
          );
          res.verifications.push(`${describeRule(rule)} : ${campaigns.length} campagne(s) vérifiée(s)`);
          for (const c of campaigns) {
            const why = check(rule, c);
            if (!why) continue;
            await push({
              kind: "alerte",
              title: `${METRICS[rule.metric].label} : ${c.name}`,
              body: `${why} · ${PERIODS[rule.period] ?? rule.period} · compte ${c.account}. Aucune modification faite : demande à MARKOVA d'analyser avant d'agir.`,
              link: `/chat?q=${encodeURIComponent(`Analyse la campagne « ${c.name} » : ${why}. Que recommandes-tu ?`)}&send=1`,
              dedupeKey: `regle:${rule.id}:${c.id}:${today}`,
            });
          }
        } catch (err) {
          res.erreurs.push(`Meta : ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  } else if (rules?.length) {
    res.erreurs.push("Meta n'est pas connecté : les règles de surveillance KPI ne peuvent pas être vérifiées.");
  }

  // ─── 2. Tâches Google : retards et échéances de demain ─────────
  const sessions = await getGoogleSessions(supabase, { userId, timezone }).catch(() => []);
  const late: string[] = [];
  const tomorrow: string[] = [];
  const todayTasks: string[] = [];
  for (const s of sessions) {
    try {
      const d = await taskDeadlines(s);
      late.push(...d.enRetard);
      tomorrow.push(...d.demain);
      todayTasks.push(...d.aujourdhui);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.erreurs.push(`Google ${s.email} : ${msg}`);
      if (msg.includes("expiré ou révoqué")) {
        await push({ kind: "probleme", title: `Google déconnecté : ${s.email}`, body: "Reconnecte ce compte dans Connexions.", link: "/connexions", dedupeKey: `google-revoque:${s.email}:${today}` });
      }
    }
  }
  if (sessions.length) res.verifications.push(`Tâches Google : ${late.length} en retard, ${todayTasks.length} aujourd'hui, ${tomorrow.length} demain`);
  const list = (xs: string[]) => xs.slice(0, 5).map((x) => `« ${x} »`).join(", ") + (xs.length > 5 ? "…" : "");
  if (late.length || todayTasks.length || tomorrow.length) {
    const parts = [
      late.length ? `${late.length} en retard : ${list(late)}` : "",
      todayTasks.length ? `${todayTasks.length} pour aujourd'hui : ${list(todayTasks)}` : "",
      tomorrow.length ? `${tomorrow.length} pour demain : ${list(tomorrow)}` : "",
    ].filter(Boolean);
    await push({
      kind: "planning",
      title: late.length ? `${late.length} tâche${late.length > 1 ? "s" : ""} en retard` : `${todayTasks.length + tomorrow.length} tâche(s) à échéance`,
      body: parts.join(" · "),
      link: `/chat?q=${encodeURIComponent("Fais-moi mon briefing du jour : agenda, mails importants et tâches. Termine par les 3 priorités.")}&send=1`,
      dedupeKey: `taches:${today}`,
    });
  }

  // ─── 3. Actions en attente de validation depuis plus d'un jour ─
  const { count } = await supabase
    .from("actions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "en_attente")
    .lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
  if (count) {
    await push({
      kind: "validation",
      title: `${count} action${count > 1 ? "s" : ""} en attente de validation`,
      body: "Des modifications proposées par MARKOVA attendent ton clic sur Confirmer ou Refuser.",
      link: "/notifications",
      dedupeKey: `validation:${today}`,
    });
  }

  return res;
}
