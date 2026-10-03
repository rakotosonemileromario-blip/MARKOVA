import { randomBytes } from "crypto";
import { requireUser } from "@/lib/supabase/server";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";

// Équipe : le propriétaire de MARKOVA crée les comptes de ses collègues (email + mot de passe qu'il leur donne).
// Chaque compte a son propre espace, totalement séparé : projets, fichiers, connexions (mail, Facebook, Google…).

/** Propriétaire : emails de OWNER_EMAILS, sinon le tout premier compte créé. */
async function isOwner(email: string | undefined) {
  if (!email) return false;
  const owners = (process.env.OWNER_EMAILS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (owners.length) return owners.includes(email.toLowerCase());
  const { data, error } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`clé de service Supabase refusée (${error.message}) : vérifie SUPABASE_SERVICE_ROLE_KEY sur Vercel`);
  const first = [...(data?.users ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  return first?.email?.toLowerCase() === email.toLowerCase();
}

async function guard() {
  const auth = await requireUser();
  if (!auth) return { error: Response.json({ error: "Non authentifié" }, { status: 401 }) };
  if (!adminConfigured()) return { error: Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY manquant sur le serveur" }, { status: 500 }) };
  let owner: boolean;
  try {
    owner = await isOwner(auth.user.email);
  } catch (err) {
    return { error: Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }) };
  }
  if (!owner) {
    const configured = Boolean((process.env.OWNER_EMAILS ?? "").trim());
    return {
      error: Response.json(
        { error: configured ? "Seul le propriétaire (OWNER_EMAILS) peut gérer l'équipe" : "Seul le propriétaire (premier compte créé) peut gérer l'équipe", owner: false },
        { status: 403 },
      ),
    };
  }
  return { auth };
}

/** Mot de passe facile à dicter : 3 groupes de 4 caractères sans ambiguïté (pas de 0/O, 1/l). */
function password() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export async function GET() {
  const g = await guard();
  if (g.error) return g.error;
  const { data, error } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({
    owner: true,
    members: (data?.users ?? [])
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((u) => ({ id: u.id, email: u.email, name: u.user_metadata?.name ?? "", created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, me: u.id === g.auth.user.id })),
  });
}

/** POST { name, email } → crée le compte et renvoie le mot de passe à transmettre au collègue. */
export async function POST(req: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const body = (await req.json().catch(() => ({}))) as { name?: string; email?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: "Adresse email invalide" }, { status: 400 });
  if (!name) return Response.json({ error: "Indique le prénom de la personne" }, { status: 400 });
  const pwd = password();
  const { data, error } = await createAdminClient().auth.admin.createUser({ email, password: pwd, email_confirm: true, user_metadata: { name } });
  if (error) {
    return Response.json({ error: /already|registered|exists/i.test(error.message) ? "Un compte existe déjà avec cet email" : error.message }, { status: 400 });
  }
  return Response.json({ id: data.user?.id, email, name, password: pwd });
}

/** DELETE { id } → supprime le compte d'un collègue (et toutes ses données). */
export async function DELETE(req: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return Response.json({ error: "id manquant" }, { status: 400 });
  if (id === g.auth.user.id) return Response.json({ error: "Tu ne peux pas supprimer ton propre compte ici" }, { status: 400 });
  const { error } = await createAdminClient().auth.admin.deleteUser(id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
