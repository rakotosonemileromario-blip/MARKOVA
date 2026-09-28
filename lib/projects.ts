import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolSet } from "./llm";

export const PROJECT_COOKIE = "markova_project";

export type Project = {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  related_ids: string[];
};

export type ProjectContext = { current: Project | null; all: Project[] };

/** Projet actif (cookie) + liste des projets de l'utilisateur. */
export async function getProjectContext(supabase: SupabaseClient, cookieValue?: string | null): Promise<ProjectContext> {
  const { data } = await supabase.from("projects").select("id, name, description, parent_id, related_ids").order("name");
  const all = (data ?? []) as Project[];
  const current = all.find((p) => p.id === cookieValue) ?? null;
  return { current, all };
}

/**
 * Projets dont la mémoire est partagée avec le projet actif :
 * son parent (A est dans B), ses sous-projets et ses projets complémentaires.
 */
export function linkedProjects(current: Project | null, all: Project[]) {
  if (!current) return [];
  const out: { project: Project; relation: string }[] = [];
  const parent = all.find((p) => p.id === current.parent_id);
  if (parent) out.push({ project: parent, relation: `projet parent (${current.name} est dans ${parent.name})` });
  for (const child of all.filter((p) => p.parent_id === current.id)) out.push({ project: child, relation: `sous-projet de ${current.name}` });
  for (const p of all.filter((p) => current.related_ids.includes(p.id) || p.related_ids.includes(current.id))) {
    if (!out.some((o) => o.project.id === p.id)) out.push({ project: p, relation: "projet complémentaire" });
  }
  return out;
}

export function describeProjectRelations(p: Project, all: Project[]) {
  const parts: string[] = [];
  const parent = all.find((x) => x.id === p.parent_id);
  if (parent) parts.push(`dans ${parent.name}`);
  const related = all.filter((x) => p.related_ids.includes(x.id) || x.related_ids.includes(p.id));
  if (related.length) parts.push(`complémentaire de ${related.map((r) => r.name).join(", ")}`);
  return parts.join(" · ");
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

function findProject(all: Project[], name: string) {
  const n = norm(name);
  return all.find((p) => norm(p.name) === n) ?? all.find((p) => norm(p.name).includes(n) || n.includes(norm(p.name))) ?? null;
}

// ─── Outils de l'agent ───────────────────────────────────────────
// Organisation interne (pas d'impact externe) : exécutée directement quand l'utilisateur le demande.
export const PROJECT_TOOLS: ToolSet["defs"] = [
  {
    name: "projet_creer",
    label: "📁 Création du projet",
    description: "Crée un nouveau projet (entreprise, client, marque) quand l'utilisateur le demande. Optionnel : parent (le nouveau projet est dans ce projet).",
    parameters: {
      type: "object",
      properties: { nom: { type: "string" }, description: { type: "string" }, parent: { type: "string", description: "Nom du projet parent" } },
      required: ["nom"],
    },
  },
  {
    name: "projets_lier",
    label: "🔗 Liaison des projets",
    description:
      "Enregistre la relation entre deux projets quand l'utilisateur la dit : « complementaire » (A et B se complètent, mémoires partagées), « inclus_dans » (A est dans B), ou « aucune » (retirer le lien).",
    parameters: {
      type: "object",
      properties: {
        projet_a: { type: "string" },
        projet_b: { type: "string" },
        relation: { type: "string", enum: ["complementaire", "inclus_dans", "aucune"] },
      },
      required: ["projet_a", "projet_b", "relation"],
    },
  },
  {
    name: "projet_activer",
    label: "📁 Changement de projet",
    description: "Change le projet actif de l'application quand l'utilisateur dit « passe sur le projet X ».",
    parameters: { type: "object", properties: { nom: { type: "string" } }, required: ["nom"] },
  },
];

/** Exécute un outil projet. `onChange` signale au navigateur qu'il faut rafraîchir / changer de projet. */
export async function runProjectTool(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  onChange: (activateId?: string) => void,
): Promise<string | null> {
  if (!["projet_creer", "projets_lier", "projet_activer"].includes(name)) return null;
  const { data } = await supabase.from("projects").select("id, name, description, parent_id, related_ids");
  const all = (data ?? []) as Project[];
  const list = () => all.map((p) => p.name).join(", ") || "aucun";

  if (name === "projet_creer") {
    const nom = String(args.nom ?? "").trim();
    if (!nom) return "Nom manquant.";
    if (findProject(all, nom) && norm(findProject(all, nom)!.name) === norm(nom)) return `Le projet « ${nom} » existe déjà.`;
    const parent = args.parent ? findProject(all, String(args.parent)) : null;
    const { data: created, error } = await supabase
      .from("projects")
      .insert({ name: nom, description: args.description ? String(args.description) : null, parent_id: parent?.id ?? null })
      .select("id")
      .single();
    if (error || !created) return `Création impossible : ${error?.message}`;
    onChange();
    return `Projet « ${nom} » créé${parent ? ` dans « ${parent.name} »` : ""}. Il n'est pas activé : l'utilisateur peut le choisir dans le menu Projet.`;
  }

  if (name === "projet_activer") {
    const p = findProject(all, String(args.nom ?? ""));
    if (!p) return `Projet introuvable. Projets : ${list()}.`;
    onChange(p.id);
    return `Projet actif : « ${p.name} » (à partir du prochain message).`;
  }

  // projets_lier
  const a = findProject(all, String(args.projet_a ?? ""));
  const b = findProject(all, String(args.projet_b ?? ""));
  if (!a || !b) return `Projet introuvable. Projets existants : ${list()}. Propose de le créer si besoin.`;
  if (a.id === b.id) return "Il faut deux projets différents.";
  const relation = String(args.relation);

  if (relation === "inclus_dans") {
    if (b.parent_id === a.id) return `Impossible : « ${b.name} » est déjà dans « ${a.name} ».`;
    await supabase.from("projects").update({ parent_id: b.id, updated_at: new Date().toISOString() }).eq("id", a.id);
    onChange();
    return `Enregistré : « ${a.name} » est dans « ${b.name} ». Leurs mémoires sont partagées.`;
  }
  if (relation === "complementaire") {
    await supabase.from("projects").update({ related_ids: [...new Set([...a.related_ids, b.id])] }).eq("id", a.id);
    await supabase.from("projects").update({ related_ids: [...new Set([...b.related_ids, a.id])] }).eq("id", b.id);
    onChange();
    return `Enregistré : « ${a.name} » et « ${b.name} » sont complémentaires. Leurs mémoires sont partagées.`;
  }
  // aucune
  await supabase
    .from("projects")
    .update({ related_ids: a.related_ids.filter((x) => x !== b.id), parent_id: a.parent_id === b.id ? null : a.parent_id })
    .eq("id", a.id);
  await supabase
    .from("projects")
    .update({ related_ids: b.related_ids.filter((x) => x !== a.id), parent_id: b.parent_id === a.id ? null : b.parent_id })
    .eq("id", b.id);
  onChange();
  return `Lien retiré entre « ${a.name} » et « ${b.name} ».`;
}
