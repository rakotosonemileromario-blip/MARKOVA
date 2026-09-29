import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { adminConfigured } from "@/lib/supabase/admin";
import { pushConfigured } from "@/lib/notify";
import { describeRule, type WatchRule } from "@/lib/monitor";
import { resolveTimezone, TZ_COOKIE } from "@/lib/timezone";
import AlertsCenter from "./AlertsCenter";
import { connectedAccounts, getMetaSession } from "@/lib/meta";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const [notifs, actions, rules, settings, timezone, followups] = await Promise.all([
    supabase.from("notifications").select("id, kind, title, body, link, read_at, created_at").order("created_at", { ascending: false }).limit(60),
    supabase.from("actions").select("id, summary, conversation_id, created_at").eq("status", "en_attente").order("created_at", { ascending: false }).limit(20),
    supabase.from("watch_rules").select("*").eq("active", true).order("created_at"),
    supabase.from("user_settings").select("weekly_report").maybeSingle(),
    resolveTimezone(supabase, (await cookies()).get(TZ_COOKIE)?.value),
    supabase.from("followups").select("id, due_at, instruction, conversation_id").eq("status", "prevue").order("due_at").limit(30),
  ]);
  // Pages et comptes Instagram proposés dans le choix des cibles des règles.
  const meta = await getMetaSession(supabase).catch(() => null);
  const accounts = meta ? await connectedAccounts(meta) : { facebook: [], instagram: [] };

  return (
    <AlertsCenter
      notifications={notifs.data ?? []}
      pendingActions={actions.data ?? []}
      followups={followups.data ?? []}
      rules={((rules.data ?? []) as WatchRule[]).map((r) => ({ id: r.id, text: describeRule(r) }))}
      accounts={accounts}
      weeklyReport={settings.data?.weekly_report ?? true}
      timezone={timezone}
      pushReady={pushConfigured()}
      cronReady={adminConfigured() && Boolean(process.env.CRON_SECRET)}
    />
  );
}
