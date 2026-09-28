import { requireUser } from "@/lib/supabase/server";
import { executeGoogleAction, getGoogleSessions } from "@/lib/google";
import { executeMetaAction, getMetaSession } from "@/lib/meta";
import { isMetaAction } from "@/lib/actions";

/**
 * POST { decision: "confirmer" | "refuser" }
 * Seul point d'exécution des actions proposées par l'agent : rien n'est fait sans ce clic.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const { supabase } = auth;
  const { id } = await params;
  const { decision } = (await req.json().catch(() => ({}))) as { decision?: string };

  const { data: action } = await supabase
    .from("actions")
    .select("id, kind, account_email, params, status")
    .eq("id", id)
    .maybeSingle();
  if (!action) return Response.json({ error: "Action introuvable" }, { status: 404 });
  if (action.status !== "en_attente") return Response.json({ status: action.status, error: "Action déjà traitée" }, { status: 409 });

  const decided_at = new Date().toISOString();

  if (decision === "refuser") {
    await supabase.from("actions").update({ status: "refusee", decided_at }).eq("id", id);
    return Response.json({ status: "refusee" });
  }
  if (decision !== "confirmer") return Response.json({ error: "Décision invalide" }, { status: 400 });

  // Verrou : on passe l'action hors « en_attente » avant d'agir (évite une double exécution).
  const { data: locked } = await supabase
    .from("actions")
    .update({ status: "executee", decided_at })
    .eq("id", id)
    .eq("status", "en_attente")
    .select("id");
  if (!locked?.length) return Response.json({ error: "Action déjà traitée" }, { status: 409 });

  try {
    let result: string;
    if (isMetaAction(action.kind)) {
      const meta = await getMetaSession(supabase);
      if (!meta) throw new Error("Meta n'est plus connecté");
      result = await executeMetaAction(meta, action.kind, action.params ?? {});
    } else {
      const sessions = await getGoogleSessions(supabase);
      const session = sessions.find((s) => s.email.toLowerCase() === String(action.account_email).toLowerCase());
      if (!session) throw new Error(`Compte ${action.account_email} non connecté`);
      result = await executeGoogleAction(session, action.kind, action.params ?? {});
    }
    await supabase.from("actions").update({ result }).eq("id", id);
    return Response.json({ status: "executee", result });
  } catch (err) {
    const result = err instanceof Error ? err.message : String(err);
    await supabase.from("actions").update({ status: "erreur", result }).eq("id", id);
    return Response.json({ status: "erreur", result }, { status: 422 });
  }
}
