import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { googleClients, googleConfigured, UPGRADE_SCOPES } from "@/lib/google";
import { resolveTimezone, TZ_COOKIE } from "@/lib/timezone";
import { Icon } from "@/components/ui";
import DisconnectButton from "./DisconnectButton";
import MetaConnect from "./MetaConnect";
import { getMetaApp } from "@/lib/meta";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  config: "Configuration Google incomplète sur le serveur (GOOGLE_CLIENT_ID_n, GOOGLE_CLIENT_SECRET_n, TOKEN_ENCRYPTION_KEY).",
  refus: "Autorisation refusée sur l'écran Google.",
  etat: "Session de connexion expirée ou invalide. Réessaie.",
  email: "Google n'a pas renvoyé l'adresse du compte.",
  meta_config: "L'app Meta n'est pas encore enregistrée : suis les 3 étapes de la section Meta ci-dessous.",
  refresh:
    "Google n'a pas fourni de jeton durable. Retire l'accès de MARKOVA sur myaccount.google.com/permissions puis reconnecte.",
};

const SOON = [
  { name: "Google Search Console", icon: "monitoring" },
  { name: "Mon Master Plan", icon: "flag" },
];

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ ok?: string; erreur?: string; meta?: string }> }) {
  const { ok, erreur, meta } = await searchParams;
  const supabase = await createClient();
  const { data: accounts } = await supabase
    .from("integrations")
    .select("id, account_email, client_slot, scopes, timezone, updated_at")
    .eq("provider", "google")
    .order("created_at");
  const timezone = await resolveTimezone(supabase, (await cookies()).get(TZ_COOKIE)?.value);
  const clients = googleClients();
  const configured = googleConfigured();
  const metaApp = await getMetaApp(supabase);
  const { data: metaRow } = await supabase
    .from("integrations")
    .select("account_email, expires_at")
    .eq("provider", "meta")
    .limit(1)
    .maybeSingle();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-[24px] font-bold tracking-tight">Connexions</h1>
        <p className="text-[13px] text-muted mt-1">Les outils que Kimia peut consulter pour toi.</p>

        {ok && (
          <p className="mt-4 flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2 text-[13px] text-ok">
            <Icon name="check_circle" className="text-[17px]" /> {ok === "1" ? "Compte Google connecté." : `${ok} connecté.`}
          </p>
        )}
        {erreur && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            <Icon name="error" className="text-[17px] mt-px" /> {ERRORS[erreur] ?? erreur}
          </p>
        )}

        <section className="card mt-5 p-4">
          <div className="flex items-start gap-3">
            <span className="grid place-items-center size-10 rounded-lg bg-soft border border-line shrink-0">
              <Icon name="mail" className="text-[21px] text-accent-text" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[17px] font-bold">Google — Gmail · Agenda · Drive · Tâches · Sheets · Analytics</h2>
              <p className="text-[13px] text-muted mt-0.5">
                Kimia lit mails, agenda, fichiers Drive et tâches de tous les comptes connectés. Elle peut aussi gérer tes tâches et écrire
                dans Google Sheets (ajouter des lignes, remplir une plage, créer un tableur), mais uniquement après ton clic sur « Confirmer ».
                Elle lit aussi les statistiques de ton site (Google Analytics). Elle n'envoie aucun mail et ne modifie pas l'agenda.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {(accounts ?? []).map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-soft border border-line px-3 py-2.5">
                <span className="size-2 rounded-full bg-ok shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-[14px] font-semibold">{a.account_email}</div>
                  <div className="text-[12px] text-muted">
                    fuseau {timezone} · depuis le {new Date(a.updated_at).toLocaleDateString("fr-FR")}
                  </div>
                </div>
                {UPGRADE_SCOPES.some((s) => !(a.scopes ?? []).includes(s)) && (
                  <a
                    href={`/api/google/connect?client=${a.client_slot}`}
                    className="rounded-lg bg-warn-soft text-warn h-8 px-2.5 inline-flex items-center gap-1 text-[12px] font-semibold"
                    title="Nécessaire pour les nouvelles fonctions : Google Analytics, tâches et Google Sheets (toujours après ta confirmation)"
                  >
                    <Icon name="sync" className="text-[16px]" /> Mettre à jour les autorisations
                  </a>
                )}
                <DisconnectButton id={a.id} email={a.account_email} />
              </div>
            ))}
            {(accounts ?? []).length === 0 && <p className="text-[13px] text-muted">Aucun compte connecté.</p>}
          </div>

          {configured ? (
            // Un bouton par client OAuth dont le compte n'est pas encore connecté.
            <div className="mt-4 flex flex-wrap gap-2">
              {clients
                .filter((c) => !(accounts ?? []).some((a) => a.client_slot === c.slot))
                .map((c) => (
                  <a
                    key={c.slot}
                    href={`/api/google/connect?client=${c.slot}`}
                    className="rounded-lg bg-accent-strong text-white h-10 px-3.5 inline-flex items-center gap-1.5 text-[13px] font-semibold glow"
                  >
                    <Icon name="add_link" className="text-[18px]" />
                    Connecter {c.hint ?? "un compte Google"}
                  </a>
                ))}
            </div>
          ) : (
            <p className="mt-4 text-[13px] text-danger">
              Configuration serveur manquante : GOOGLE_CLIENT_ID_1, GOOGLE_CLIENT_SECRET_1 et TOKEN_ENCRYPTION_KEY (voir README).
            </p>
          )}
        </section>

        <section className="card mt-4 p-4">
          <div className="flex items-start gap-3 mb-4">
            <span className="grid place-items-center size-10 rounded-lg bg-soft border border-line shrink-0">
              <Icon name="campaign" className="text-[21px] text-cyan" />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold">Meta — Ads · Facebook · Instagram</h2>
              <p className="text-[13px] text-muted mt-0.5">
                Kimia lit tes campagnes (KPI exacts : CPL, CTR, CPM, ROAS…), tes créatifs, et les publications de tes pages Facebook et comptes
                Instagram. Il peut proposer de mettre en pause, réactiver ou changer un budget : rien n'est modifié sans ton clic sur « Confirmer ».
              </p>
            </div>
          </div>
          <MetaConnect
            connected={metaRow ? { name: metaRow.account_email, expiresAt: metaRow.expires_at } : null}
            appReady={Boolean(metaApp)}
            appFromEnv={Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET)}
            openPicker={meta === "choisir"}
          />
        </section>

        <h2 className="label-caps mt-8 mb-2.5 text-muted">Bientôt</h2>
        <div className="card divide-y divide-line">
          {SOON.map((s) => (
            <div key={s.name} className="flex items-center gap-3 px-4 py-3 text-[14px]">
              <Icon name={s.icon} className="text-[20px] text-muted" />
              <span className="flex-1">{s.name}</span>
              <span className="text-[11px] text-muted">à venir</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
