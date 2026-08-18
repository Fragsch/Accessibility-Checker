import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Die Oberflaeche liegt in `web/` und wird nach `dist/web/` gebaut, von wo der
 * Fastify-Server sie ausliefert.
 *
 * Im Entwicklungsbetrieb laeuft Vite auf 5173 und reicht alles unter `/api`
 * an den Server auf 3000 weiter — so bleibt die Oberflaeche gleich adressiert,
 * ob gebaut oder nicht.
 */
export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Der Schraegstrich am Ende ist wesentlich: als blosses Praefix "/api"
      // wuerde auch die eigene Datei "web/api.ts" an den Server geleitet, und
      // die Oberflaeche bekaeme HTML statt ihres eigenen Moduls.
      '^/api/': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
});
