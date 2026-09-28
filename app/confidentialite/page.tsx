import type { Metadata } from "next";

export const metadata: Metadata = { title: "Politique de confidentialité · MARKOVA" };

const CONTACT = "romario.reactive@gmail.com";

/** Page publique exigée par Meta et Google pour les connexions (Facebook Login, Google OAuth). */
export default function Confidentialite() {
  return (
    <main className="min-h-dvh overflow-y-auto">
      <article className="md mx-auto max-w-2xl px-5 py-10">
        <h1>Politique de confidentialité — MARKOVA</h1>
        <p>Dernière mise à jour : 29 septembre 2026.</p>

        <h2>Qui sommes-nous</h2>
        <p>
          MARKOVA est un assistant personnel de marketing digital à usage privé. Il est utilisé uniquement par son propriétaire. Contact : <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>

        <h2>Données consultées</h2>
        <p>Uniquement lorsque l&apos;utilisateur connecte volontairement ses comptes, MARKOVA peut lire :</p>
        <ul>
          <li>Meta (Facebook, Instagram, Meta Ads) : pages et publications, statistiques Instagram, comptes publicitaires, campagnes et leurs performances ;</li>
          <li>Google : e-mails, agenda, fichiers Drive et tâches du compte connecté.</li>
        </ul>
        <p>
          Ces données servent exclusivement à produire des analyses et des recommandations pour l&apos;utilisateur. Aucune modification (mise en pause d&apos;une publicité,
          changement de budget, suppression d&apos;une tâche…) n&apos;est effectuée sans sa confirmation explicite.
        </p>

        <h2>Stockage et sécurité</h2>
        <ul>
          <li>Les jetons d&apos;accès sont chiffrés (AES-256-GCM) avant d&apos;être enregistrés dans une base de données privée (Supabase), protégée par authentification.</li>
          <li>Les données consultées ne sont ni vendues, ni louées, ni partagées avec des tiers, ni utilisées à des fins publicitaires.</li>
          <li>
            Les textes nécessaires à une analyse peuvent être transmis au moteur d&apos;intelligence artificielle utilisé pour générer la réponse, uniquement pour
            produire cette réponse.
          </li>
        </ul>

        <h2>Suppression des données</h2>
        <p>
          L&apos;utilisateur peut à tout moment déconnecter un compte dans MARKOVA (page Connexions) : le jeton est supprimé et l&apos;autorisation est retirée. Il peut aussi
          retirer l&apos;accès depuis les paramètres Facebook (Paramètres → Apps et sites web) ou Google (myaccount.google.com/permissions). Voir{" "}
          <a href="/suppression-donnees">les instructions de suppression des données</a>.
        </p>

        <h2>Contact</h2>
        <p>
          Pour toute question : <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </article>
    </main>
  );
}
