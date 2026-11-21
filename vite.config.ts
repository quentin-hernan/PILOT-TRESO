import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev`        -> http://localhost:5173 (le micro fonctionne sur localhost)
// `npm run dev:https`  -> https://<adresse>:5173 (nécessaire pour utiliser le micro depuis un téléphone)

// Ces deux en-têtes « isolent » la page : le navigateur autorise alors le moteur vocal à utiliser plusieurs cœurs du
// processeur (3 à 4 fois plus rapide). Même réglage en production : voir public/_headers (Netlify).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig(({ mode }) => ({
  plugins: mode === 'https' ? [react(), basicSsl()] : [react()],
  server: { headers: isolation },
  preview: { headers: isolation },
  // Le moteur vocal sur l'appareil tourne dans un « worker » (module) pour ne pas figer l'écran.
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
}));
