-- PILOT'TRESO — étape 2 : tables, sécurité par rôle (Row Level Security), inscription.
-- À exécuter UNE fois dans Supabase : SQL Editor > New query > coller > Run.
-- Montants en centimes (entiers). Chaque donnée appartient à un utilisateur (compte particulier)
-- ou à une organisation (compte professionnel).

------------------------------------------------------------------------------
-- Types
------------------------------------------------------------------------------
create type public.account_type as enum ('particulier', 'professionnel');
create type public.org_mode     as enum ('solo', 'equipe');
create type public.member_role  as enum ('patron', 'employe');
create type public.op_kind      as enum ('depense', 'recette');

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  account_type public.account_type not null,
  created_at   timestamptz not null default now()
);

create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  mode       public.org_mode not null default 'solo',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.members (
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
-- V1 : un utilisateur appartient à une seule organisation.
create unique index members_one_org_per_user on public.members (user_id);

create table public.invitations (
  code       text primary key,
  org_id     uuid not null references public.organizations (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by    uuid references auth.users (id),
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create table public.categories (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references auth.users (id) on delete cascade,
  org_id       uuid references public.organizations (id) on delete cascade,
  slug         text not null,
  label        text not null,
  icon         text not null,
  color        text not null,
  kind         public.op_kind not null,
  budget_cents bigint check (budget_cents is null or budget_cents >= 0),
  constraint categories_one_owner check ((owner_id is null) <> (org_id is null)),
  unique (owner_id, slug),
  unique (org_id, slug)
);

create table public.operations (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references auth.users (id) on delete cascade,
  org_id       uuid references public.organizations (id) on delete cascade,
  created_by   uuid not null default auth.uid() references auth.users (id),
  kind         public.op_kind not null,
  amount_cents bigint not null check (amount_cents > 0),
  category_id  uuid references public.categories (id) on delete set null,
  label        text not null default '',
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint operations_one_owner check ((owner_id is null) <> (org_id is null))
);
create index operations_owner_idx on public.operations (owner_id, occurred_at desc);
create index operations_org_idx   on public.operations (org_id, occurred_at desc);
create index operations_author_idx on public.operations (created_by);

create table public.recurrences (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references auth.users (id) on delete cascade,
  org_id       uuid references public.organizations (id) on delete cascade,
  kind         public.op_kind not null,
  amount_cents bigint not null check (amount_cents > 0),
  category_id  uuid references public.categories (id) on delete set null,
  label        text not null,
  day_of_month int not null check (day_of_month between 1 and 31),
  active       boolean not null default true,
  constraint recurrences_one_owner check ((owner_id is null) <> (org_id is null))
);

-- Factures et échéances (compte professionnel uniquement).
create table public.invoices (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  counterparty text not null,
  label        text not null default '',
  amount_cents bigint not null check (amount_cents > 0),
  due_date     date not null,
  direction    text not null check (direction in ('a_encaisser', 'a_payer')),
  status       text not null default 'en_attente' check (status in ('en_attente', 'payee')),
  created_by   uuid not null default auth.uid() references auth.users (id),
  created_at   timestamptz not null default now()
);

------------------------------------------------------------------------------
-- Fonctions d'aide (security definer : évitent les boucles entre règles de sécurité)
------------------------------------------------------------------------------
create function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where org_id = p_org and user_id = auth.uid());
$$;

create function public.is_org_patron(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members
                 where org_id = p_org and user_id = auth.uid() and role = 'patron');
$$;

-- Le patron peut voir le profil (nom) des membres de son organisation.
create function public.is_patron_of_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members mine
    join public.members theirs on theirs.org_id = mine.org_id
    where mine.user_id = auth.uid() and mine.role = 'patron' and theirs.user_id = p_user
  );
$$;

revoke all on function public.is_org_member(uuid), public.is_org_patron(uuid), public.is_patron_of_user(uuid) from public;
grant execute on function public.is_org_member(uuid), public.is_org_patron(uuid), public.is_patron_of_user(uuid) to authenticated;

------------------------------------------------------------------------------
-- Catégories par défaut
------------------------------------------------------------------------------
create function public.seed_personal_categories(p_user uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.categories (owner_id, slug, label, icon, color, kind, budget_cents) values
    (p_user, 'salaire',       'Salaire',       '💼', '#12a971', 'recette', null),
    (p_user, 'autre-recette', 'Autre recette', '🎁', '#0ea5a4', 'recette', null),
    (p_user, 'logement',      'Logement',      '🏠', '#6366f1', 'depense', 75000),
    (p_user, 'alimentation',  'Alimentation',  '🛒', '#f59e0b', 'depense', 45000),
    (p_user, 'carburant',     'Carburant',     '⛽', '#ef4444', 'depense', 15000),
    (p_user, 'restaurant',    'Restaurant',    '🍽️', '#ec4899', 'depense', 12000),
    (p_user, 'electricite',   'Électricité',   '💡', '#eab308', 'depense', 9000),
    (p_user, 'abonnements',   'Abonnements',   '📺', '#8b5cf6', 'depense', 3000),
    (p_user, 'loisirs',       'Loisirs',       '🎬', '#06b6d4', 'depense', 8000),
    (p_user, 'sante',         'Santé',         '💊', '#14b8a6', 'depense', 5000),
    (p_user, 'transport',     'Transport',     '🚆', '#3b82f6', 'depense', 6000),
    (p_user, 'credit',        'Crédit',        '🏦', '#64748b', 'depense', 26500);
$$;

create function public.seed_org_categories(p_org uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.categories (org_id, slug, label, icon, color, kind) values
    (p_org, 'ventes',       'Ventes',        '🧾', '#12a971', 'recette'),
    (p_org, 'prestations',  'Prestations',   '🛠️', '#0ea5a4', 'recette'),
    (p_org, 'carburant',    'Carburant',     '⛽', '#ef4444', 'depense'),
    (p_org, 'achats',       'Achats',        '📦', '#f59e0b', 'depense'),
    (p_org, 'fournitures',  'Fournitures',   '🖇️', '#8b5cf6', 'depense'),
    (p_org, 'energie',      'Énergie',       '💡', '#eab308', 'depense'),
    (p_org, 'assurances',   'Assurances',    '🛡️', '#6366f1', 'depense'),
    (p_org, 'telephone',    'Téléphone',     '📱', '#06b6d4', 'depense'),
    (p_org, 'deplacements', 'Déplacements',  '🚗', '#3b82f6', 'depense');
$$;

revoke all on function public.seed_personal_categories(uuid), public.seed_org_categories(uuid) from public;

------------------------------------------------------------------------------
-- Inscription : tout est créé d'un bloc (profil, organisation, rôle, catégories)
-- à partir des informations passées à signUp (user_metadata).
------------------------------------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta   jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_type public.account_type := coalesce(nullif(meta->>'account_type', ''), 'particulier')::public.account_type;
  v_name text := coalesce(nullif(trim(meta->>'display_name'), ''), split_part(new.email, '@', 1));
  v_code text := upper(nullif(trim(meta->>'invite_code'), ''));
  v_mode public.org_mode := coalesce(nullif(meta->>'mode', ''), 'solo')::public.org_mode;
  v_org_name text := coalesce(nullif(trim(meta->>'org_name'), ''), 'Mon entreprise');
  v_org  uuid;
  v_inv  public.invitations%rowtype;
begin
  if v_code is not null then
    -- Employé : rejoint l'organisation grâce à un code d'invitation à usage unique.
    select * into v_inv from public.invitations
      where code = v_code and used_by is null and expires_at > now()
      for update;
    if not found then
      raise exception 'Code d''invitation invalide ou expiré';
    end if;
    insert into public.profiles (id, display_name, account_type) values (new.id, v_name, 'professionnel');
    insert into public.members (org_id, user_id, role) values (v_inv.org_id, new.id, 'employe');
    update public.invitations set used_by = new.id, used_at = now() where code = v_code;

  elsif v_type = 'professionnel' then
    insert into public.profiles (id, display_name, account_type) values (new.id, v_name, 'professionnel');
    insert into public.organizations (name, mode, created_by) values (v_org_name, v_mode, new.id)
      returning id into v_org;
    insert into public.members (org_id, user_id, role) values (v_org, new.id, 'patron');
    perform public.seed_org_categories(v_org);

  else
    insert into public.profiles (id, display_name, account_type) values (new.id, v_name, 'particulier');
    perform public.seed_personal_categories(new.id);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

------------------------------------------------------------------------------
-- Invitations : création (patron) et vérification avant inscription
------------------------------------------------------------------------------
create function public.create_invitation(p_org uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_org_patron(p_org) then
    raise exception 'Réservé au patron';
  end if;
  if not exists (select 1 from public.organizations where id = p_org and mode = 'equipe') then
    raise exception 'Cette organisation n''accepte pas d''employés';
  end if;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.invitations (code, org_id, created_by) values (v_code, p_org, auth.uid());
  return v_code;
end;
$$;

-- Utilisable avant connexion : renvoie le nom de l'entreprise si le code est valide.
create function public.check_invitation(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select o.name from public.invitations i
  join public.organizations o on o.id = i.org_id
  where i.code = upper(trim(p_code)) and i.used_by is null and i.expires_at > now();
$$;

revoke all on function public.create_invitation(uuid), public.check_invitation(text) from public;
grant execute on function public.create_invitation(uuid) to authenticated;
grant execute on function public.check_invitation(text) to anon, authenticated;

------------------------------------------------------------------------------
-- Sécurité par rôle (Row Level Security)
------------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.organizations enable row level security;
alter table public.members       enable row level security;
alter table public.invitations   enable row level security;
alter table public.categories    enable row level security;
alter table public.operations    enable row level security;
alter table public.recurrences   enable row level security;
alter table public.invoices      enable row level security;

-- Droits de base (les règles RLS ci-dessous filtrent ensuite ligne par ligne).
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.organizations, public.members, public.invitations to authenticated;
grant update (display_name) on public.profiles to authenticated;      -- jamais account_type
grant update (name) on public.organizations to authenticated;          -- jamais mode / created_by
grant delete on public.members, public.invitations to authenticated;
grant select, insert, update, delete on public.categories, public.operations,
  public.recurrences, public.invoices to authenticated;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_patron_of_user(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- organizations
create policy orgs_select on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy orgs_update on public.organizations for update to authenticated
  using (public.is_org_patron(id)) with check (public.is_org_patron(id));

-- members : on voit sa propre ligne ; le patron voit et retire ses employés.
create policy members_select on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_org_patron(org_id));
create policy members_delete on public.members for delete to authenticated
  using (public.is_org_patron(org_id) and user_id <> auth.uid());

-- invitations : le patron seulement
create policy invitations_select on public.invitations for select to authenticated
  using (public.is_org_patron(org_id));
create policy invitations_delete on public.invitations for delete to authenticated
  using (public.is_org_patron(org_id) and used_by is null);

-- categories : lecture pour tous les membres (l'employé doit pouvoir choisir), écriture patron / propriétaire
create policy categories_select on public.categories for select to authenticated
  using (owner_id = auth.uid() or public.is_org_member(org_id));
create policy categories_write on public.categories for all to authenticated
  using (owner_id = auth.uid() or public.is_org_patron(org_id))
  with check (owner_id = auth.uid() or public.is_org_patron(org_id));

-- operations
--  * compte particulier : le propriétaire
--  * compte pro : le patron voit et gère tout ; l'employé ne voit, ne crée, ne modifie et ne supprime
--    QUE SES PROPRES dépenses.
create policy operations_select on public.operations for select to authenticated
  using (owner_id = auth.uid()
         or public.is_org_patron(org_id)
         or (created_by = auth.uid() and public.is_org_member(org_id)));
create policy operations_insert on public.operations for insert to authenticated
  with check (created_by = auth.uid()
              and (owner_id = auth.uid()
                   or public.is_org_patron(org_id)
                   or (public.is_org_member(org_id) and kind = 'depense')));
create policy operations_update on public.operations for update to authenticated
  using (owner_id = auth.uid()
         or public.is_org_patron(org_id)
         or (created_by = auth.uid() and public.is_org_member(org_id)))
  with check (owner_id = auth.uid()
              or public.is_org_patron(org_id)
              or (created_by = auth.uid() and public.is_org_member(org_id) and kind = 'depense'));
create policy operations_delete on public.operations for delete to authenticated
  using (owner_id = auth.uid()
         or public.is_org_patron(org_id)
         or (created_by = auth.uid() and public.is_org_member(org_id)));

-- recurrences : propriétaire ou patron
create policy recurrences_all on public.recurrences for all to authenticated
  using (owner_id = auth.uid() or public.is_org_patron(org_id))
  with check (owner_id = auth.uid() or public.is_org_patron(org_id));

-- invoices : patron uniquement
create policy invoices_all on public.invoices for all to authenticated
  using (public.is_org_patron(org_id))
  with check (public.is_org_patron(org_id));
