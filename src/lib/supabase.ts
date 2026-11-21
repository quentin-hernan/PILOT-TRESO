import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Faux tant que le fichier .env.local n'est pas rempli : l'app reste alors en mode démo. */
export const supabaseConfigured = Boolean(url && key && url.startsWith('http'));

export const supabase = supabaseConfigured ? createClient(url!, key!) : null;
