import type { ToolSet } from "./llm";
import { ACTION_KINDS } from "./google";
import { META_ACTION_KINDS } from "./meta";

// Outil « proposer_action » : l'agent propose, l'utilisateur confirme d'un clic, le serveur exécute.

export const isMetaAction = (kind: string) => kind.startsWith("meta_");

export function proposeActionTool({ google, meta }: { google: boolean; meta: boolean }): ToolSet["defs"][number] | null {
  const kinds = [...(google ? ACTION_KINDS : []), ...(meta ? META_ACTION_KINDS : [])];
  if (!kinds.length) return null;
  const help = [
    google &&
      "tache_supprimer (params: tache_id, liste_id), tache_terminer (params: tache_id, liste_id), tache_creer (params: titre, notes?, echeance? AAAA-MM-JJ, liste_id?) — ids issus de taches_lister, « compte » = adresse Google ; " +
        "sheets_ajouter_lignes (params: fichier_id, lignes [[…],[…]], feuille?) ajoute à la fin, sheets_ecrire (params: fichier_id, plage ex. « A1 » ou « Onglet!B2 », lignes, feuille?) remplace la plage, " +
        "sheets_creer (params: titre, lignes?, feuille?) — fichier_id = id Drive issu de drive_rechercher, lignes = tableau de lignes de valeurs, « compte » = adresse Google",
    meta &&
      "meta_pause (params: objet_id), meta_activer (params: objet_id), meta_budget (params: objet_id, budget_quotidien en unités de la devise, ex. 25 pour 25 €) — objet_id = id de campagne, d'ensemble ou de publicité issu de meta_performances ; « compte » = « meta » ; " +
        "meta_audience_similaire (params: audience_source_id issu de meta_audiences, pays code ISO ex. « MG », pourcentage 1–10, nom?, compte?), " +
        "meta_audience_engagement (params: source « page » ou « instagram », page = nom de la page, jours 1–365, nom?, compte?), " +
        "meta_audience_site (params: pixel_id issu de meta_audiences, jours 1–180, url_contient?, nom?, compte?)",
  ]
    .filter(Boolean)
    .join(" ; ");

  return {
    name: "proposer_action",
    label: "🔐 Actions à valider",
    description:
      "Propose une ou plusieurs modifications à l'utilisateur (elles ne sont PAS exécutées : il les confirme d'un clic). " +
      "Mets TOUTES les actions dans le tableau « actions » d'un seul appel. Types : " +
      help +
      ". Ne propose une action que si les données la justifient et en respectant les règles de la mémoire.",
    parameters: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: kinds },
              compte: { type: "string" },
              params: { type: "object" },
              motif: { type: "string", description: "Pourquoi (données qui justifient l'action)" },
            },
            required: ["type", "params"],
          },
        },
      },
      required: ["actions"],
    },
  };
}
