-- MARKOVA — schéma V1
-- À exécuter une fois dans Supabase : SQL Editor > New query > coller > Run.
-- Chaque ligne appartient à un utilisateur ; la sécurité RLS empêche tout accès croisé.

-- ─── Projets ────────────────────────────────────────────────────
-- Chaque projet a sa mémoire, ses fichiers et ses conversations.
-- parent_id : « le projet A est dans le projet B » ; related_ids : projets complémentaires.
create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  name         text not null,
  description  text,
  parent_id    uuid references public.projects on delete set null,
  related_ids  uuid[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists projects_user on public.projects (user_id, name);

-- ─── Conversations ──────────────────────────────────────────────
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  title       text not null default 'Nouvelle conversation',
  file_ids    uuid[] not null default '{}',   -- fichiers attachés à la conversation
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists conversations_user_updated on public.conversations (user_id, updated_at desc);

-- ─── Messages ───────────────────────────────────────────────────
create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations on delete cascade,
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  meta             jsonb not null default '{}',  -- modèle, compétences, sources, fichiers
  created_at       timestamptz not null default now()
);
create index if not exists messages_conversation_created on public.messages (conversation_id, created_at);

-- ─── Mémoire (règles, préférences, objectifs, décisions, infos projet, seuils) ───
create table if not exists public.memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  category    text not null check (category in ('projet', 'objectif', 'regle', 'seuil', 'preference', 'decision', 'apprentissage')),
  skill       text,               -- null = s'applique partout ; sinon id de compétence
  content     text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists memories_user on public.memories (user_id, category);

-- ─── Fichiers ───────────────────────────────────────────────────
create table if not exists public.files (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users on delete cascade,
  name            text not null,
  storage_path    text not null unique,
  mime_type       text not null default 'application/octet-stream',
  size_bytes      bigint not null default 0,
  kind            text not null default 'autre',   -- pdf, docx, tableur, texte, image, autre
  extracted_text  text,
  kpi_summary     text,                             -- KPI calculés de façon déterministe
  status          text not null default 'en_attente' check (status in ('en_attente', 'pret', 'erreur')),
  error           text,
  created_at      timestamptz not null default now()
);
create index if not exists files_user_created on public.files (user_id, created_at desc);

-- ─── Connexions externes (Google…) ──────────────────────────────
-- Plusieurs comptes Google possibles, chacun lié au client OAuth (« slot ») qui l'a autorisé.
-- Le jeton de rafraîchissement est chiffré côté serveur (AES-256-GCM) avant stockage.
create table if not exists public.integrations (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users on delete cascade,
  provider           text not null,
  client_slot        text not null default '1',
  account_email      text not null,
  refresh_token_enc  text not null,
  scopes             text[] not null default '{}',
  timezone           text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, provider, account_email)
);

-- Expiration du jeton (Meta : 60 jours en connexion Facebook ; null = sans expiration)
alter table public.integrations add column if not exists expires_at timestamptz;
-- Réglages d'une connexion (ex. Meta : pages, comptes Instagram et comptes pub choisis)
alter table public.integrations add column if not exists settings jsonb not null default '{}';

-- ─── Rattachement au projet (null = général / tous les projets) ───
alter table public.conversations add column if not exists project_id uuid references public.projects on delete set null;
alter table public.memories      add column if not exists project_id uuid references public.projects on delete set null;
alter table public.files         add column if not exists project_id uuid references public.projects on delete set null;
create index if not exists conversations_project on public.conversations (project_id, updated_at desc);
create index if not exists memories_project on public.memories (project_id);
create index if not exists files_project on public.files (project_id, created_at desc);

-- ─── Actions proposées par l'agent (exécutées seulement après validation) ───
create table if not exists public.actions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  conversation_id  uuid references public.conversations on delete cascade,
  kind             text not null,                -- ex. tache_supprimer, tache_terminer, tache_creer
  account_email    text,
  params           jsonb not null default '{}',
  summary          text not null,               -- ce qui sera fait, lisible par l'utilisateur
  reason           text,                        -- pourquoi l'agent le propose
  status           text not null default 'en_attente' check (status in ('en_attente', 'executee', 'refusee', 'erreur')),
  result           text,
  created_at       timestamptz not null default now(),
  decided_at       timestamptz
);
create index if not exists actions_conversation on public.actions (conversation_id, created_at);

-- ─── Compétences ajoutées par l'utilisateur (en plus de /skills) ───
create table if not exists public.custom_skills (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  name           text not null,
  description    text not null default '',
  keywords       text[] not null default '{}',
  prompt         text not null,
  always_loaded  boolean not null default false,
  active         boolean not null default true,
  source_name    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ─── Réglages de l'utilisateur (fuseau de l'appareil, rapport hebdo) ───
create table if not exists public.user_settings (
  user_id         uuid primary key default auth.uid() references auth.users on delete cascade,
  timezone        text,                               -- fuseau détecté sur le PC / téléphone
  weekly_report   boolean not null default true,      -- rapport hebdomadaire du lundi
  updated_at      timestamptz not null default now()
);

-- ─── Règles de surveillance (« préviens-moi si le CPL dépasse 12 € ») ───
create table if not exists public.watch_rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  metric      text not null check (metric in ('cpl', 'cpa', 'cpc', 'cpm', 'ctr', 'roas', 'frequence', 'depenses')),
  operator    text not null check (operator in ('>', '<')),
  threshold   numeric not null,
  period      text not null default 'last_7d' check (period in ('yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d')),
  scope       text,               -- null = toutes les campagnes actives ; sinon texte contenu dans le nom de campagne
  label       text,               -- description lisible
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Règles étendues aux réseaux sociaux : source (pubs Meta, page Facebook, Instagram),
-- nouvelles métriques (likes, commentaires, partages, vues, publications) et mode de calcul.
alter table public.watch_rules add column if not exists source text not null default 'ads';
alter table public.watch_rules add column if not exists aggregation text not null default 'total';
alter table public.watch_rules drop constraint if exists watch_rules_metric_check;
alter table public.watch_rules add constraint watch_rules_metric_check check (metric in (
  'cpl', 'cpa', 'cpc', 'cpm', 'ctr', 'roas', 'frequence', 'depenses', 'leads', 'clics', 'impressions',
  'likes', 'commentaires', 'partages', 'vues', 'publications'));
alter table public.watch_rules drop constraint if exists watch_rules_source_check;
alter table public.watch_rules add constraint watch_rules_source_check check (source in ('ads', 'facebook', 'instagram'));
alter table public.watch_rules drop constraint if exists watch_rules_aggregation_check;
alter table public.watch_rules add constraint watch_rules_aggregation_check check (aggregation in ('total', 'publication'));

-- ─── Notifications (alerte, planning, validation, rapport, problème) ───
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  kind        text not null check (kind in ('alerte', 'planning', 'validation', 'rapport', 'probleme')),
  title       text not null,
  body        text not null default '',
  link        text,
  dedupe_key  text,                -- évite d'envoyer deux fois la même alerte
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index if not exists notifications_user_created on public.notifications (user_id, created_at desc);

-- ─── Notifications push (PC / téléphone) ───
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  device      text,
  created_at  timestamptz not null default now()
);

-- ─── Relances programmées (« rends-moi compte dans 3 h ») ───
create table if not exists public.followups (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  conversation_id  uuid references public.conversations on delete cascade,
  due_at           timestamptz not null,
  instruction      text not null,                  -- ce que MARKOVA devra vérifier et rapporter
  status           text not null default 'prevue' check (status in ('prevue', 'en_cours', 'faite', 'erreur', 'annulee')),
  result           text,
  created_at       timestamptz not null default now(),
  done_at          timestamptz
);
create index if not exists followups_due on public.followups (status, due_at);

-- ─── Voix de marque (par projet ; un sous-projet sans voix hérite de celle de son parent) ───
alter table public.projects add column if not exists brand_voice text;

-- ─── Veille concurrentielle ─────────────────────────────────────
-- Concurrents suivis : leurs pages (accueil, tarifs, offres) sont relues chaque jour.
create table if not exists public.competitors (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  project_id  uuid references public.projects on delete set null,
  name        text not null,
  urls        text[] not null default '{}',
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists competitors_user on public.competitors (user_id, name);

-- Historique : un relevé par page à chaque changement de contenu (prix, offres, messages, nouveautés).
create table if not exists public.competitor_snapshots (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  competitor_id  uuid not null references public.competitors on delete cascade,
  url            text not null,
  content_hash   text not null,
  page_text      text,                           -- texte lu (comparé ligne à ligne au passage suivant)
  facts          jsonb not null default '{}',    -- { prix: [{produit, prix}], offres: [], messages: [], nouveautes: [] }
  changes        jsonb not null default '[]',    -- [{ type: prix|offre|message|nouveaute, detail }]
  error          text,
  checked_at     timestamptz not null default now()
);
create index if not exists competitor_snapshots_comp on public.competitor_snapshots (competitor_id, url, checked_at desc);

-- ─── RLS ────────────────────────────────────────────────────────
alter table public.competitors          enable row level security;
alter table public.competitor_snapshots enable row level security;
alter table public.followups          enable row level security;
alter table public.user_settings      enable row level security;
alter table public.watch_rules        enable row level security;
alter table public.notifications      enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.memories      enable row level security;
alter table public.files         enable row level security;
alter table public.integrations  enable row level security;
alter table public.actions       enable row level security;
alter table public.projects      enable row level security;
alter table public.custom_skills enable row level security;

do $$
declare t text;
begin
  foreach t in array array['projects', 'conversations', 'messages', 'memories', 'files', 'integrations', 'actions', 'custom_skills',
                           'user_settings', 'watch_rules', 'notifications', 'push_subscriptions', 'followups',
                           'competitors', 'competitor_snapshots'] loop
    execute format('drop policy if exists "owner_all" on public.%I', t);
    execute format(
      'create policy "owner_all" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ─── Stockage des fichiers ──────────────────────────────────────
-- Bucket privé ; chaque utilisateur ne voit que le dossier <son user_id>/...
insert into storage.buckets (id, name, public)
values ('files', 'files', false)
on conflict (id) do nothing;

drop policy if exists "files_owner_select" on storage.objects;
drop policy if exists "files_owner_insert" on storage.objects;
drop policy if exists "files_owner_delete" on storage.objects;

create policy "files_owner_select" on storage.objects for select to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "files_owner_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "files_owner_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
