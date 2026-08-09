import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    // Reinicia el proceso principal al guardar cambios en src/main.
    // El renderer se actualiza en caliente sin reiniciar nada.
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: resolve('src/main/index.mjs'),
        // node:sqlite es nativo del runtime de Electron: no se empaqueta.
        external: ['electron', 'node:sqlite'],
        output: { format: 'es', entryFileNames: 'index.js' },
      },
    },
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: resolve('src/preload/index.mjs'),
        external: ['electron'],
        // El preload corre sandboxed: requiere CommonJS.
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: resolve('dist/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
      },
    },
  },
});
