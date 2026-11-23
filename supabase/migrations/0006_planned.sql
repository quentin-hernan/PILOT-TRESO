-- PILOT'TRESO — dépenses et recettes PRÉVUES à une date précise (ponctuelles, dans le futur).
-- À exécuter UNE fois dans Supabase : SQL Editor > New query > coller > Run.
-- (Après 0001 à 0005.)
--
-- Exemple : « le 28, j'ai 80 € d'assurance » dit le 23 novembre. L'ajout est enregistré comme PRÉVU : il apparaît dans
-- « À venir », compte dans le disponible du mois et dans les prévisions, puis devient une vraie opération le 28
-- (créée automatiquement à l'ouverture de l'application, comme les récurrences).

create table public.planned_operations (
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
create index planned_owner_idx on public.planned_operations (owner_id, planned_date);
create index planned_org_idx   on public.planned_operations (org_id, planned_date);

alter table public.planned_operations enable row level security;
grant select, insert, update, delete on public.planned_operations to authenticated;

-- propriétaire (particulier) ou patron (professionnel) uniquement : un employé n'y a pas accès
create policy planned_all on public.planned_operations for all to authenticated
  using (owner_id = auth.uid() or public.is_org_patron(org_id))
  with check (owner_id = auth.uid() or public.is_org_patron(org_id));

-- Transforme en vraies opérations les opérations prévues dont la date est arrivée (jusqu'à aujourd'hui, heure de Paris).
-- « security invoker » : les règles de sécurité s'appliquent ; chaque ligne est verrouillée, donc jamais créée deux fois.
create function public.apply_planned() returns integer
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
