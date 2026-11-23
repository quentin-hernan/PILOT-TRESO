-- ===== 0003_planning =====
-- PILOT'TRESO — étape 5 : récurrences automatiques, budgets, factures réelles.
-- À exécuter UNE fois dans Supabase : SQL Editor > New query > coller > Run.
-- (Après 0001_init.sql et 0002_operations.sql.)
--
-- Les tables recurrences, invoices et la colonne categories.budget_cents existent déjà (étape 2) avec leurs
-- règles de sécurité : propriétaire / patron uniquement. Cette migration ajoute seulement :
--  1. la mémoire de la dernière date générée pour chaque récurrence ;
--  2. la fonction qui crée les opérations récurrentes arrivées à échéance.

alter table public.recurrences add column if not exists last_applied date;

-- Crée les opérations des récurrences actives dont la date est passée (jusqu'à aujourd'hui, heure de Paris).
--  * « security invoker » : s'exécute avec les droits de l'utilisateur connecté, donc les règles de sécurité
--    s'appliquent (un employé ne voit aucune récurrence : rien n'est créé pour lui) ;
--  * chaque récurrence est verrouillée pendant le calcul : deux appareils ouverts en même temps ne créent
--    jamais deux fois la même opération ;
--  * rattrapage limité à 24 mois ; un jour 31 devient le dernier jour des mois plus courts.
-- Renvoie le nombre d'opérations créées.
create or replace function public.apply_recurrences() returns integer
language plpgsql security invoker set search_path = public as $$
declare
  r        record;
  v_today  date := (now() at time zone 'Europe/Paris')::date;
  v_from   date;
  v_month  date;
  v_last   int;
  v_day    date;
  v_count  integer := 0;
begin
  for r in
    select * from public.recurrences
    where active and (owner_id = auth.uid() or public.is_org_patron(org_id))
    for update
  loop
    v_from := greatest(coalesce(r.last_applied, v_today), (v_today - interval '24 months')::date);
    v_month := date_trunc('month', v_from)::date;
    while v_month <= v_today loop
      v_last := extract(day from (v_month + interval '1 month' - interval '1 day'))::int;
      v_day := v_month + (least(r.day_of_month, v_last) - 1);
      if v_day > v_from and v_day <= v_today then
        insert into public.operations (owner_id, org_id, created_by, kind, amount_cents, category_id, label, occurred_at)
        values (r.owner_id, r.org_id, auth.uid(), r.kind, r.amount_cents, r.category_id, r.label,
                (v_day::timestamp + interval '12 hours') at time zone 'Europe/Paris');
        v_count := v_count + 1;
      end if;
      v_month := (v_month + interval '1 month')::date;
    end loop;
    update public.recurrences set last_applied = v_today where id = r.id;
  end loop;
  return v_count;
end $$;

revoke all on function public.apply_recurrences() from public;
grant execute on function public.apply_recurrences() to authenticated;

-- ===== 0004_no_default_budgets =====
-- PILOT'TRESO — les nouveaux comptes particuliers démarrent SANS budget par catégorie.
-- À exécuter UNE fois dans Supabase : SQL Editor > New query > coller > Run.
--
-- Avant, chaque nouveau compte recevait des budgets d'exemple (Alimentation 450 €, Carburant 150 €…).
-- Désormais chacun fixe les siens (à l'écran, ou à la voix : « budget alimentation 400 euros »).
-- Les budgets déjà présents sur les comptes existants ne sont PAS modifiés : pour les retirer,
-- utiliser le bouton « Retirer tous les budgets » de l'onglet Catégories.

create or replace function public.seed_personal_categories(p_user uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.categories (owner_id, slug, label, icon, color, kind, budget_cents) values
    (p_user, 'salaire',       'Salaire',       '💼', '#12a971', 'recette', null),
    (p_user, 'autre-recette', 'Autre recette', '🎁', '#0ea5a4', 'recette', null),
    (p_user, 'logement',      'Logement',      '🏠', '#6366f1', 'depense', null),
    (p_user, 'alimentation',  'Alimentation',  '🛒', '#f59e0b', 'depense', null),
    (p_user, 'carburant',     'Carburant',     '⛽', '#ef4444', 'depense', null),
    (p_user, 'restaurant',    'Restaurant',    '🍽️', '#ec4899', 'depense', null),
    (p_user, 'electricite',   'Électricité',   '💡', '#eab308', 'depense', null),
    (p_user, 'abonnements',   'Abonnements',   '📺', '#8b5cf6', 'depense', null),
    (p_user, 'loisirs',       'Loisirs',       '🎬', '#06b6d4', 'depense', null),
    (p_user, 'sante',         'Santé',         '💊', '#14b8a6', 'depense', null),
    (p_user, 'transport',     'Transport',     '🚆', '#3b82f6', 'depense', null),
    (p_user, 'credit',        'Crédit',        '🏦', '#64748b', 'depense', null);
$$;

revoke all on function public.seed_personal_categories(uuid) from public;

-- ===== 0005_opening_date =====
-- PILOT'TRESO — le solde de départ est le solde d'un JOUR précis.
-- À exécuter UNE fois dans Supabase : SQL Editor > New query > coller > Run.
-- (Après 0001 à 0004.)
--
-- Exemple : le 23 novembre, vous renseignez 250 €. Le solde affiché part de 250 € ce jour-là : les opérations
-- enregistrées avant le 23 novembre n'en font plus partie, celles du 23 et d'après s'y ajoutent.
-- Les comptes existants n'ont pas de date (colonne vide) : leur solde continue de compter toutes les opérations
-- jusqu'à ce que vous renseigniez à nouveau le solde de départ.

alter table public.profiles      add column if not exists opening_date date;
alter table public.organizations add column if not exists opening_date date;

grant update (display_name, opening_balance_cents, opening_date) on public.profiles to authenticated;
grant update (name, opening_balance_cents, opening_date) on public.organizations to authenticated;

-- ===== 0006_planned =====
-- PILOT'TRESO — dépenses et recettes PRÉVUES à une date précise (ponctuelles, dans le futur).
-- À exécuter UNE fois dans Supabase : SQL Editor > New query > coller > Run.
-- (Après 0001 à 0005.)
--
-- Exemple : « le 28, j'ai 80 € d'assurance » dit le 23 novembre. L'ajout est enregistré comme PRÉVU : il apparaît dans
-- « À venir », compte dans le disponible du mois et dans les prévisions, puis devient une vraie opération le 28
-- (créée automatiquement à l'ouverture de l'application, comme les récurrences).

create table if not exists public.planned_operations (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references auth.users (id) on delete cascade,
  org_id       uuid references public.organizations (id) on delete cascade,
  created_by   uuid not null default auth.uid() references auth.users (id),
  kind         public.op_kind not null,
  amount_cents bigint not null check (amount_cents > 0),
  category_id  uuid references public.categories (id) on delete set null,
  label        text not null default '',
  planned_date date not null,
  created_at   timestamptz not null default now(),
  constraint planned_one_owner check ((owner_id is null) <> (org_id is null))
);
create index if not exists planned_owner_idx on public.planned_operations (owner_id, planned_date);
create index if not exists planned_org_idx   on public.planned_operations (org_id, planned_date);

alter table public.planned_operations enable row level security;
grant select, insert, update, delete on public.planned_operations to authenticated;

-- propriétaire (particulier) ou patron (professionnel) uniquement : un employé n'y a pas accès
drop policy if exists planned_all on public.planned_operations;
create policy planned_all on public.planned_operations for all to authenticated
  using (owner_id = auth.uid() or public.is_org_patron(org_id))
  with check (owner_id = auth.uid() or public.is_org_patron(org_id));

-- Transforme en vraies opérations les opérations prévues dont la date est arrivée (jusqu'à aujourd'hui, heure de Paris).
-- « security invoker » : les règles de sécurité s'appliquent ; chaque ligne est verrouillée, donc jamais créée deux fois.
create or replace function public.apply_planned() returns integer
language plpgsql security invoker set search_path = public as $$
declare
  r       record;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_count integer := 0;
begin
  for r in
    select * from public.planned_operations
    where planned_date <= v_today and (owner_id = auth.uid() or public.is_org_patron(org_id))
    order by planned_date
    for update
  loop
    insert into public.operations (owner_id, org_id, created_by, kind, amount_cents, category_id, label, occurred_at)
    values (r.owner_id, r.org_id, auth.uid(), r.kind, r.amount_cents, r.category_id, r.label,
            (r.planned_date::timestamp + interval '12 hours') at time zone 'Europe/Paris');
    delete from public.planned_operations where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function public.apply_planned() from public;
grant execute on function public.apply_planned() to authenticated;

