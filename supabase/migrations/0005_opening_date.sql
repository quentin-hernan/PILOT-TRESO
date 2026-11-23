-- PILOT'TRESO — le solde de départ est le solde d'un JOUR précis.
-- À exécuter UNE fois dans Supabase : SQL Editor > New query > coller > Run.
-- (Après 0001 à 0004.)
--
-- Exemple : le 23 novembre, vous renseignez 250 €. Le solde affiché part de 250 € ce jour-là : les opérations
-- enregistrées avant le 23 novembre n'en font plus partie, celles du 23 et d'après s'y ajoutent.
-- Les comptes existants n'ont pas de date (colonne vide) : leur solde continue de compter toutes les opérations
-- jusqu'à ce que vous renseigniez à nouveau le solde de départ.

alter table public.profiles      add column opening_date date;
alter table public.organizations add column opening_date date;

grant update (display_name, opening_balance_cents, opening_date) on public.profiles to authenticated;
grant update (name, opening_balance_cents, opening_date) on public.organizations to authenticated;
