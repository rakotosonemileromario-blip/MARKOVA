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

-- ─── RLS ────────────────────────────────────────────────────────
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
  foreach t in array array['projects', 'conversations', 'messages', 'memories', 'files', 'integrations', 'actions', 'custom_skills'] loop
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
