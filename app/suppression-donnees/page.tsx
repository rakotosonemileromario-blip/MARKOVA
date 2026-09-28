import type { Metadata } from "next";

export const metadata: Metadata = { title: "Suppression des données · MARKOVA" };

const CONTACT = "romario.reactive@gmail.com";

/** Instructions publiques de suppression des données (exigées par Meta). */
export default function SuppressionDonnees() {
  return (
    <main className="min-h-dvh overflow-y-auto">
      <article className="md mx-auto max-w-2xl px-5 py-10">
        <h1>Suppression des données — MARKOVA</h1>
        <p>Pour supprimer les données liées à Facebook, Instagram ou Meta Ads :</p>
        <ol>
          <li>Dans MARKOVA, ouvrir la page <strong>Connexions</strong> puis cliquer sur <strong>Déconnecter</strong> dans la section Meta : le jeton d&apos;accès est supprimé immédiatement et l&apos;autorisation est retirée auprès de Meta.</li>
          <li>
            Ou, depuis Facebook : <strong>Paramètres et confidentialité → Paramètres → Apps et sites web</strong>, sélectionner <strong>MARKOVA</strong> puis
            <strong> Supprimer</strong>.
          </li>
          <li>
            Pour demander la suppression de toute autre donnée (conversations, fichiers, mémoire), écrire à <a href={`mailto:${CONTACT}`}>{CONTACT}</a> : la suppression est
            effectuée sous 30 jours.
          </li>
        </ol>
      </article>
    </main>
  );
}
