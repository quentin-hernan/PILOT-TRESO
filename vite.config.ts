import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev`        -> http://localhost:5173 (le micro fonctionne sur localhost)
// `npm run dev:https`  -> https://<adresse>:5173 (nécessaire pour utiliser le micro depuis un téléphone)
export default defineConfig(({ mode }) => ({
  plugins: mode === 'https' ? [react(), basicSsl()] : [react()],
  // Le moteur vocal sur l'appareil tourne dans un « worker » (module) pour ne pas figer l'écran.
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
}));
