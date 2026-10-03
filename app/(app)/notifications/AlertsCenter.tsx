"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui";
import { NOTIFICATIONS_EVENT } from "@/components/NotificationBell";
import RuleBuilder from "./RuleBuilder";
import { disablePush as turnOffPush, enablePush as turnOnPush, pushStatus } from "@/lib/push-client";

type Notif = { id: string; kind: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string };
type Pending = { id: string; summary: string; conversation_id: string | null; created_at: string };

const KINDS: Record<string, { icon: string; cls: string; label: string }> = {
  alerte: { icon: "error", cls: "text-danger bg-danger-soft", label: "Alerte" },
  planning: { icon: "event_upcoming", cls: "text-warn bg-warn-soft", label: "Planning" },
  validation: { icon: "verified_user", cls: "text-accent-text bg-accent-soft", label: "Validation" },
  rapport: { icon: "summarize", cls: "text-ok bg-ok-soft", label: "Rapport" },
  probleme: { icon: "warning", cls: "text-warn bg-warn-soft", label: "Problème" },
};


export default function AlertsCenter(props: {
  notifications: Notif[];
  pendingActions: Pending[];
  followups: { id: string; due_at: string; instruction: string; conversation_id: string | null }[];
  rules: { id: string; text: string }[];
  accounts: { facebook: string[]; instagram: string[] };
  weeklyReport: boolean;
  timezone: string;
  pushReady: boolean;
  cronReady: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [push, setPush] = useState<"inconnu" | "actif" | "inactif" | "bloque" | "indisponible">("inconnu");
  const [weekly, setWeekly] = useState(props.weeklyReport);

  const unread = props.notifications.filter((n) => !n.read_at).length;

  useEffect(() => {
    (async () => {
      if (!props.pushReady) return setPush("indisponible");
      const s = await pushStatus();
      setPush(s === "sans-cles" ? "indisponible" : s);
    })();
  }, [props.pushReady]);

  const refresh = () => {
    window.dispatchEvent(new Event(NOTIFICATIONS_EVENT));
    router.refresh();
  };

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await fn() });
      refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function post(url: string, body?: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Erreur ${res.status}`);
    return json;
  }

  const checkNow = () =>
    run("check", async () => {
      const r = (await post("/api/surveillance/run")) as { nouvelles: number; verifications: string[]; erreurs: string[] };
      return [
        r.nouvelles ? `${r.nouvelles} nouvelle(s) notification(s).` : "Vérification faite : rien de nouveau.",
        ...r.verifications,
        ...r.erreurs.map((e) => `⚠️ ${e}`),
      ].join("\n");
    });

  const reportNow = () =>
    run("report", async () => {
      const r = (await post("/api/rapport")) as { conversationId: string };
      router.push(`/c/${r.conversationId}`);
      return "Rapport généré.";
    });

  const enablePush = () =>
    run("push", async () => {
      const s = await turnOnPush(true);
      setPush(s === "sans-cles" ? "indisponible" : s);
      if (s === "bloque") throw new Error("Notifications bloquées : Paramètres du téléphone → Applications → MARKOVA → Notifications → Autoriser.");
      if (s !== "actif") throw new Error("Notifications non acceptées.");
      return "Notifications activées sur cet appareil : une notification de test vient d'être envoyée.";
    });

  const disablePush = () =>
    run("push", async () => {
      await turnOffPush();
      setPush("inactif");
      return "Notifications désactivées sur cet appareil.";
    });

  const markAllRead = () =>
    run("read", async () => {
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
      return "Tout est marqué comme lu.";
    });

  async function openNotif(n: Notif) {
    if (!n.read_at) await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
    window.dispatchEvent(new Event(NOTIFICATIONS_EVENT));
    router.push(n.link || "/notifications");
  }

  const removeNotif = (id: string) =>
    run("del", async () => {
      await supabase.from("notifications").delete().eq("id", id);
      return "Notification supprimée.";
    });

  const removeRule = (id: string) =>
    run("rule", async () => {
      await supabase.from("watch_rules").delete().eq("id", id);
      return "Règle supprimée.";
    });

  const cancelFollowup = (id: string) =>
    run("followup", async () => {
      await supabase.from("followups").update({ status: "annulee" }).eq("id", id).eq("status", "prevue");
      return "Compte rendu annulé.";
    });

  const toggleWeekly = () =>
    run("weekly", async () => {
      await post("/api/settings", { weekly_report: !weekly });
      setWeekly(!weekly);
      return !weekly ? "Rapport hebdomadaire activé (chaque lundi matin)." : "Rapport hebdomadaire désactivé.";
    });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight">Alertes</h1>
            <p className="text-[13px] text-muted mt-1">
              Kimia surveille tes campagnes, tâches et accès chaque jour et te prévient. Elle ne modifie jamais rien tout seul.
            </p>
          </div>
          <button
            onClick={checkNow}
            disabled={busy !== null}
            className="rounded-lg bg-accent-strong text-white h-10 px-3.5 inline-flex items-center gap-1.5 text-[13px] font-semibold glow disabled:opacity-60"
          >
            <Icon name={busy === "check" ? "progress_activity" : "radar"} className={`text-[18px] ${busy === "check" ? "animate-spin" : ""}`} />
            Vérifier maintenant
          </button>
        </div>

        {message && (
          <p className={`whitespace-pre-line rounded-lg px-3 py-2 text-[13px] ${message.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>{message.text}</p>
        )}
        {!props.cronReady && (
          <p className="rounded-lg bg-warn-soft text-warn px-3 py-2 text-[13px]">
            La vérification automatique quotidienne n'est pas encore active : il manque SUPABASE_SERVICE_ROLE_KEY ou CRON_SECRET dans Vercel. Le bouton « Vérifier
            maintenant » fonctionne déjà.
          </p>
        )}

        {/* Notifications sur l'appareil */}
        <section className="card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid place-items-center size-10 rounded-lg bg-soft border border-line shrink-0">
              <Icon name="phonelink_ring" className="text-[21px] text-cyan" />
            </span>
            <div className="flex-1 min-w-[200px]">
              <h2 className="font-semibold">Notifications sur cet appareil</h2>
              <p className="text-[12px] text-muted">
                {push === "actif" && "Actives : tu seras prévenu même MARKOVA fermé."}
                {push === "inactif" && "Active-les sur ton PC et sur ton téléphone (fais-le sur chaque appareil)."}
                {push === "bloque" && "Bloquées : sur le téléphone, Paramètres → Applications → MARKOVA → Notifications → Autoriser (ou, dans un navigateur, autorise ce site)."}
                {push === "indisponible" && (props.pushReady ? "Non prises en charge par ce navigateur. Sur iPhone : ajoute MARKOVA à l'écran d'accueil d'abord." : "Clés de notification absentes sur le serveur (VAPID).")}
                {push === "inconnu" && "…"}
              </p>
            </div>
            {push === "inactif" && (
              <button onClick={enablePush} disabled={busy !== null} className="rounded-lg bg-accent-strong text-white h-9 px-3 text-[13px] font-semibold disabled:opacity-60">
                Activer
              </button>
            )}
            {push === "actif" && (
              <button onClick={disablePush} disabled={busy !== null} className="rounded-lg border border-line h-9 px-3 text-[13px] text-muted">
                Désactiver
              </button>
            )}
          </div>
        </section>

        {/* Liste */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="label-caps">Notifications{unread ? ` · ${unread} non lue${unread > 1 ? "s" : ""}` : ""}</h2>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-[12px] text-accent-text font-semibold">
                Tout marquer comme lu
              </button>
            )}
          </div>
          <div className="space-y-2">
            {props.notifications.length === 0 && (
              <p className="card p-4 text-[13px] text-muted">Aucune notification pour l'instant. Ajoute une règle de surveillance ci-dessous, puis « Vérifier maintenant ».</p>
            )}
            {props.notifications.map((n) => {
              const k = KINDS[n.kind] ?? KINDS.alerte;
              return (
                <div key={n.id} className={`card flex items-start gap-3 p-3 ${n.read_at ? "opacity-70" : "is-active"}`}>
                  <span className={`grid place-items-center size-9 rounded-lg shrink-0 ${k.cls}`}>
                    <Icon name={k.icon} className="text-[19px]" />
                  </span>
                  <button onClick={() => openNotif(n)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-muted">{k.label}</span>
                      {!n.read_at && <span className="size-1.5 rounded-full bg-cyan" />}
                      <span className="ml-auto text-[11px] text-muted shrink-0">
                        {new Date(n.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: props.timezone })}
                      </span>
                    </div>
                    <div className="text-[14px] font-semibold leading-snug mt-0.5">{n.title}</div>
                    {n.body && <div className="text-[13px] text-muted leading-snug mt-0.5">{n.body}</div>}
                  </button>
                  <button onClick={() => removeNotif(n.id)} className="text-muted hover:text-danger p-1" aria-label="Supprimer">
                    <Icon name="close" className="text-[17px]" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Relances programmées */}
        <section className="card p-4">
          <h2 className="font-semibold flex items-center gap-2">
            <Icon name="alarm" className="text-[19px] text-warn" /> Comptes rendus programmés
          </h2>
          <p className="text-[12px] text-muted mt-1">
            Dis dans le chat « rends-moi compte dans 3 h » ou « à 18 h, dis-moi si le CPL a baissé » : Kimia refait l'analyse à l'heure dite et te prévient.
          </p>
          <ul className="mt-3 space-y-2">
            {props.followups.length === 0 && <li className="text-[13px] text-muted">Aucun compte rendu prévu.</li>}
            {props.followups.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded-lg bg-soft border border-line px-3 py-2 text-[13px]">
                <span className="shrink-0 rounded-md bg-warn-soft text-warn px-2 h-6 inline-flex items-center font-semibold">
                  ⏰ {new Date(f.due_at).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: props.timezone })}
                </span>
                <Link href={f.conversation_id ? `/c/${f.conversation_id}` : "/chat"} className="flex-1 min-w-0 truncate hover:underline" title={f.instruction}>
                  {f.instruction}
                </Link>
                <button onClick={() => cancelFollowup(f.id)} className="text-muted hover:text-danger" aria-label="Annuler ce compte rendu">
                  <Icon name="close" className="text-[17px]" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Actions en attente */}
        {props.pendingActions.length > 0 && (
          <section className="card p-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Icon name="verified_user" className="text-[19px] text-accent-text" /> Actions en attente de ta validation
            </h2>
            <ul className="mt-3 space-y-2">
              {props.pendingActions.map((a) => (
                <li key={a.id}>
                  <Link
                    href={a.conversation_id ? `/c/${a.conversation_id}` : "/chat"}
                    className="flex items-center gap-2 rounded-lg bg-soft border border-line px-3 py-2 text-[13px] hover:border-accent"
                  >
                    <span className="flex-1">{a.summary}</span>
                    <Icon name="chevron_right" className="text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Règles de surveillance */}
        <section className="card p-4">
          <h2 className="font-semibold flex items-center gap-2">
            <Icon name="visibility" className="text-[19px] text-cyan" /> Règles de surveillance
          </h2>
          <p className="text-[12px] text-muted mt-1">
            Pubs Meta, pages Facebook et Instagram, vérifiées chaque matin. Tu peux aussi le dire dans le chat : « préviens-moi si le CPL dépasse 12 € » ou « alerte-moi
            si un post Jokenay dépasse 100 commentaires ».
          </p>
          <ul className="mt-3 space-y-2">
            {props.rules.length === 0 && <li className="text-[13px] text-muted">Aucune règle pour l'instant.</li>}
            {props.rules.map((r) => (
              <li key={r.id} className="flex items-start gap-2 rounded-lg bg-soft border border-line px-3 py-2 text-[13px]">
                <span className="flex-1 min-w-0 break-words leading-snug">{r.text}</span>
                <button onClick={() => removeRule(r.id)} className="shrink-0 text-muted hover:text-danger p-0.5" aria-label="Supprimer la règle">
                  <Icon name="delete" className="text-[17px]" />
                </button>
              </li>
            ))}
          </ul>
          <RuleBuilder
            accounts={props.accounts}
            onDone={(text, ok) => {
              setMessage({ ok, text });
              if (ok) refresh();
            }}
          />
        </section>

        {/* Rapport hebdomadaire */}
        <section className="card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid place-items-center size-10 rounded-lg bg-soft border border-line shrink-0">
              <Icon name="summarize" className="text-[21px] text-ok" />
            </span>
            <div className="flex-1 min-w-[200px]">
              <h2 className="font-semibold">Rapport hebdomadaire</h2>
              <p className="text-[12px] text-muted">
                Chaque lundi matin : publicités, réseaux sociaux, problèmes, opportunités, priorités et semaine à venir. {weekly ? "Activé." : "Désactivé."}
              </p>
            </div>
            <button onClick={toggleWeekly} disabled={busy !== null} className="rounded-lg border border-line h-9 px-3 text-[13px]">
              {weekly ? "Désactiver" : "Activer"}
            </button>
            <button
              onClick={reportNow}
              disabled={busy !== null}
              className="rounded-lg bg-accent-strong text-white h-9 px-3 text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {busy === "report" && <Icon name="progress_activity" className="text-[16px] animate-spin" />}
              {busy === "report" ? "Génération (1 à 2 min)…" : "Générer maintenant"}
            </button>
          </div>
        </section>

        <p className="text-[12px] text-muted text-center">
          Fuseau horaire utilisé : <strong>{props.timezone}</strong> (détecté sur l'appareil que tu utilises).
        </p>
      </div>
    </div>
  );
}
