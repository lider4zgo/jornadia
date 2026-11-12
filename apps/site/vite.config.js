import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// El sitio se compila dentro de la carpeta de la app (apps/web/dist/_site):
// un solo Worker sirve korporia.com y app.korporia.com (ver apps/api/src/index.ts).
export default defineConfig({
  build: {
    outDir: resolve(__dirname, '../web/dist/_site'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        en: resolve(__dirname, 'en/index.html'),
        precios: resolve(__dirname, 'precios/index.html'),
        enPrecios: resolve(__dirname, 'en/precios/index.html'),
      },
    },
  },
});
