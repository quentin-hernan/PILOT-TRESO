-- PILOT'TRESO — étape 3 : opérations réelles.
-- À exécuter UNE fois dans Supabase : SQL Editor > New query > coller > Run.
-- (Après 0001_init.sql.)

-- 1. Solde de départ (point de départ du solde, modifiable par le propriétaire / le patron)
alter table public.profiles      add column opening_balance_cents bigint not null default 0;
alter table public.organizations add column opening_balance_cents bigint not null default 0;

-- Les règles de sécurité existantes s'appliquent déjà (chacun ne modifie que son profil ;
-- seul le patron modifie l'organisation). On ouvre seulement ce champ en écriture.
grant update (display_name, opening_balance_cents) on public.profiles to authenticated;
grant update (name, opening_balance_cents) on public.organizations to authenticated;

-- 2. Temps réel : le solde se met à jour tout seul quand une opération est ajoutée
--    (par exemple quand un employé saisit une dépense, le patron la voit apparaître).
--    Les règles de sécurité restent appliquées : chacun ne reçoit que ce qu'il a le droit de voir.
alter publication supabase_realtime add table public.operations;
