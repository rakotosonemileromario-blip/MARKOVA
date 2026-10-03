import { requireUser } from "@/lib/supabase/server";
import { sendPush } from "@/lib/notify";

type Sub = { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

/** POST { subscription, device, test? } — abonne cet appareil aux notifications push. */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const { subscription, device, test } = (await req.json().catch(() => ({}))) as { subscription?: Sub; device?: string; test?: boolean };
  const { endpoint, keys } = subscription ?? {};
  if (!endpoint?.startsWith("https://") || !keys?.p256dh || !keys.auth) return Response.json({ error: "Abonnement invalide" }, { status: 400 });

  const { error } = await auth.supabase
    .from("push_subscriptions")
    .upsert({ user_id: auth.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, device: device?.slice(0, 80) ?? null }, { onConflict: "endpoint" });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  if (test) {
    await sendPush(auth.supabase, auth.user.id, { kind: "rapport", title: "Notifications activées", body: "Kimia pourra te prévenir sur cet appareil.", link: "/notifications" });
  }
  return Response.json({ ok: true });
}

/** DELETE { endpoint } — désabonne cet appareil. */
export async function DELETE(req: Request) {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (endpoint) await auth.supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return Response.json({ ok: true });
}
