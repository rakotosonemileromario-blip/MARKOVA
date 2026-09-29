# MARKOVA — V1 « Cerveau »

Agent personnel de Digital Marketing. Spécification complète : [docs/CAHIER_DES_CHARGES.md](docs/CAHIER_DES_CHARGES.md).

## Ce que fait la V1

- **Chat** avec un agent central unique, réponses en streaming, historique synchronisé (PC ↔ téléphone).
- **Compétences** chargées automatiquement selon la demande : Direction Marketing (toujours active), Calendrier, Contenu, Publicités, Media Buying. Une compétence = un dossier dans [`skills/`](skills/).
- **Fichiers** : PDF, DOCX, XLSX, CSV, TXT, images. Les exports publicitaires (CSV/XLSX) sont reconnus et leurs **KPI calculés exactement** (CPM, CTR, CPC, CPL, CPA, ROAS, fréquence) avant d'être transmis à l'IA.
- **Mémoire projet** : projet, objectifs, règles, seuils, préférences, décisions, apprentissages. L'agent propose d'enregistrer les règles que vous énoncez ; vous validez d'un clic.
- **Moteurs IA gratuits avec bascule** : Gemini (modèle principal → modèle léger) puis Ollama (local ou Ollama Cloud) si le quota est atteint.
- **Google (lecture seule)** : agenda, Gmail, Drive, Google Tasks. « Mon briefing du jour », « mes tâches aujourd'hui », « retrouve le mail de… », « analyse le fichier Drive… ». Le contenu des mails est traité comme une donnée, jamais comme une instruction.
- **Recherche Web** : Tavily si une clé est configurée, sinon recherche Google de Gemini (souvent absente du quota gratuit).

## Installation (une seule fois)

### 1. Base de données Supabase
1. Supabase → **SQL Editor** → *New query* → coller le contenu de [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
2. **Authentication → Users → Add user** : votre email + mot de passe, cocher *Auto Confirm User*.
3. **Authentication → Sign In / Providers** : désactiver *Allow new users to sign up* (usage personnel : personne d'autre ne peut créer de compte).

### 2. Configuration
Les clés vont dans **`.env.local`** (privé, jamais publié). `.env.example` n'est qu'un modèle vide.

### 3. Connexion Google (Gmail, Agenda, Drive, Tâches) — lecture seule
Dans [Google Cloud Console](https://console.cloud.google.com) (le projet d'Agent Punk peut servir) :
1. **API et services → Bibliothèque** : activer *Gmail API*, *Google Calendar API*, *Google Drive API*, *Google Tasks API*.
2. **Écran de consentement OAuth** :
   - boîte mail **Google Workspace** (domaine de l'entreprise) → type **Interne** : aucun contrôle Google, accès durable ;
   - adresse **@gmail.com** → type **Externe**, ajouter l'adresse dans *Utilisateurs test*. ⚠️ En mode « Test », Google coupe l'accès au bout de **7 jours** : il faut alors se reconnecter (bouton « Changer de compte » dans Connexions).
3. **Identifiants → Créer → ID client OAuth → Application Web** (différent du client Android d'Agent Punk) avec comme URI de redirection :
   - `http://localhost:3000/api/google/callback`
   - `https://<votre-app>.vercel.app/api/google/callback` (après mise en ligne)
4. Copier l'ID client et le code secret dans `GOOGLE_CLIENT_ID_1` / `GOOGLE_CLIENT_SECRET_1` de `.env.local` (deuxième projet Google Cloud → `_2`, etc. ; plusieurs comptes Google peuvent être connectés en même temps). `TOKEN_ENCRYPTION_KEY` est déjà générée : **ne jamais la changer** une fois un compte connecté (sinon il faut reconnecter).
5. Dans MARKOVA : **🔌 Connexions → Connecter mon compte Google**.

### 4. Connexion Meta (Ads, Facebook, Instagram) — bouton « Connecter avec Facebook »
Meta impose une « app » pour tout bouton de connexion. Elle est gratuite, reste privée (mode Développement) et se crée une fois :

1. [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Créer une app** → cas d'usage **« Autre »** → type **« Entreprise »** → nom « MARKOVA » → lier ton portefeuille Business.
2. Dans l'app → **Ajouter un produit** : **Facebook Login for Business** et **Marketing API**.
3. **Facebook Login for Business → Configurations → Créer une configuration** :
   type de jeton « Jeton d'accès utilisateur », puis cocher les permissions `ads_read`, `ads_management`, `business_management`, `pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic`, `instagram_manage_insights`, et les éléments (comptes pub, pages, Instagram). Copier l'**ID de configuration**.
4. **Facebook Login for Business → Paramètres** → « URI de redirection OAuth valides » : `http://localhost:3000/api/meta/callback` (et plus tard `https://<ton-app>.vercel.app/api/meta/callback`).
5. **Paramètres de l'app → Général** : copier l'**ID de l'app** et la **clé secrète**.
6. Dans `.env.local` : `META_APP_ID=…`, `META_APP_SECRET=…`, `META_CONFIG_ID=…`, puis relancer `npm run dev`.
7. MARKOVA → **Connexions → Connecter avec Facebook** → choisir tes pages, comptes Instagram et comptes publicitaires.

L'accès dure 60 jours (Connexions affiche les jours restants ; un clic sur « Reconnecter » le renouvelle). En mode Développement, en tant qu'administrateur de l'app, tu accèdes à tes propres comptes sans validation Meta.

*Option avancée :* un jeton d'utilisateur système (Business Manager → Utilisateurs système → Générer un jeton, expiration « Jamais ») peut être collé dans Connexions ; il n'expire pas.

### 5. Lancer en local
```bash
npm install
npm run dev
```
Puis ouvrir http://localhost:3000.

## Mise en ligne (Vercel, gratuit)
1. Publier le dossier sur un dépôt GitHub **privé** (`.env.local` est exclu automatiquement).
2. Vercel → *Add New Project* → importer le dépôt.
3. *Environment Variables* : recopier les variables de `.env.local`.
4. *Deploy*. L'adresse obtenue (ex. `markova.vercel.app`) sert aussi de base pour l'APK Android (V5).

### Surveillance, alertes et rapport hebdomadaire
- `vercel.json` déclare deux tâches planifiées gratuites : surveillance chaque jour (5 h UTC) et rapport chaque lundi (5 h 30 UTC).
- Variables nécessaires dans Vercel : `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- Page **Alertes** : règles de surveillance (CPL, CTR, ROAS…), notifications, activation du push sur chaque appareil, rapport « Générer maintenant ».
- Le fuseau horaire est celui de l'appareil utilisé (PC ou téléphone), détecté automatiquement.
- Google Sheets en écriture : activer « Google Sheets API » dans chaque projet Google Cloud, puis « Mettre à jour les autorisations » dans Connexions.

## Structure
```
app/            pages (chat, fichiers, mémoire, compétences) et routes API
components/     interface
lib/            agent central, moteurs IA, KPI, extraction de fichiers, recherche Web
skills/         compétences (prompt.md, rules.md, skill.json)
supabase/       schéma de base de données
```

## Ajouter une compétence
Créer `skills/<id>/` avec `prompt.md`, `rules.md` et `skill.json` (copier un existant). Aucune modification de code nécessaire.
