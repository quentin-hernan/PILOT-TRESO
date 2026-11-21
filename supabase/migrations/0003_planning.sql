-- PILOT'TRESO — étape 5 : récurrences automatiques, budgets, factures réelles.
-- À exécuter UNE fois dans Supabase : SQL Editor > New query > coller > Run.
-- (Après 0001_init.sql et 0002_operations.sql.)
--
-- Les tables recurrences, invoices et la colonne categories.budget_cents existent déjà (étape 2) avec leurs
-- règles de sécurité : propriétaire / patron uniquement. Cette migration ajoute seulement :
--  1. la mémoire de la dernière date générée pour chaque récurrence ;
--  2. la fonction qui crée les opérations récurrentes arrivées à échéance.

alter table public.recurrences add column last_applied date;

-- Crée les opérations des récurrences actives dont la date est passée (jusqu'à aujourd'hui, heure de Paris).
--  * « security invoker » : s'exécute avec les droits de l'utilisateur connecté, donc les règles de sécurité
--    s'appliquent (un employé ne voit aucune récurrence : rien n'est créé pour lui) ;
--  * chaque récurrence est verrouillée pendant le calcul : deux appareils ouverts en même temps ne créent
--    jamais deux fois la même opération ;
--  * rattrapage limité à 24 mois ; un jour 31 devient le dernier jour des mois plus courts.
-- Renvoie le nombre d'opérations créées.
create function public.apply_recurrences() returns integer
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
