import { Brand } from '../components/Brand';

/** Affiché tant que les clés Supabase ne sont pas renseignées. */
export function SetupScreen({ onDemo }: { onDemo: () => void }) {
  return (
    <main className="welcome">
      <Brand />
      <section className="auth-card">
        <h2>Connexion à Supabase</h2>
        <p className="muted center">Les clés Supabase ne sont pas encore renseignées.</p>
        <ol className="setup-steps">
          <li>
            Dans Supabase : <b>Project Settings → API</b>, copiez l'<b>URL</b> et la clé <b>anon / publishable</b>.
          </li>
          <li>
            Copiez le fichier <code>.env.example</code> en <code>.env.local</code> et collez-y les deux valeurs.
          </li>
          <li>
            Relancez <code>npm run dev</code>.
          </li>
        </ol>
        <button className="btn btn-primary block" onClick={onDemo}>
          Continuer avec la démonstration
        </button>
      </section>
    </main>
  );
}
