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
