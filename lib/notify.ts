import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { secretEnv } from "./supabase/admin";

// Notifications : enregistrées dans la table « notifications » (cloche dans l'app)
// et envoyées en push sur les appareils abonnés (PC, téléphone), gratuitement.

export type NotificationKind = "alerte" | "planning" | "validation" | "rapport" | "probleme";

export const KIND_LABELS: Record<NotificationKind, { emoji: string; label: string }> = {
  alerte: { emoji: "🔴", label: "Alerte" },
  planning: { emoji: "🟠", label: "Planning" },
  validation: { emoji: "🔵", label: "Validation" },
  rapport: { emoji: "🟢", label: "Rapport" },
  probleme: { emoji: "⚠️", label: "Problème" },
};

export type NewNotification = { kind: NotificationKind; title: string; body?: string; link?: string; dedupeKey?: string };

export const pushConfigured = () => Boolean(secretEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY") && secretEnv("VAPID_PRIVATE_KEY"));

let vapidReady = false;
function initVapid() {
  if (vapidReady || !pushConfigured()) return vapidReady;
  webpush.setVapidDetails(
    secretEnv("VAPID_SUBJECT") || "https://markova.app",
    secretEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
    secretEnv("VAPID_PRIVATE_KEY"),
  );
  vapidReady = true;
  return true;
}

/**
 * Crée une notification (ignorée si la même dedupeKey existe déjà) puis l'envoie en push.
 * Renvoie true si elle est nouvelle.
 */
export async function notify(supabase: SupabaseClient, userId: string, n: NewNotification): Promise<boolean> {
  const { data, error } = await supabase
    .from("notifications")
    .upsert(
      { user_id: userId, kind: n.kind, title: n.title, body: n.body ?? "", link: n.link ?? null, dedupe_key: n.dedupeKey ?? null },
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) return false;
  await sendPush(supabase, userId, n).catch(() => {});
  return true;
}

export async function sendPush(supabase: SupabaseClient, userId: string, n: NewNotification) {
  if (!initVapid()) return 0;
  const { data: subs } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  const { emoji } = KIND_LABELS[n.kind];
  const payload = JSON.stringify({ title: `${emoji} ${n.title}`, body: n.body?.slice(0, 240) ?? "", url: n.link ?? "/notifications", tag: n.dedupeKey });
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600 });
      sent++;
    } catch (err) {
      // Abonnement expiré (appareil désinscrit) : on le retire.
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await supabase.from("push_subscriptions").delete().eq("id", s.id);
    }
  }
  return sent;
}
