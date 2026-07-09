import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Native / runtime modules that MUST stay external in the main bundle.
// better-sqlite3 is a native .node addon; @prisma runtime is resolved at run time
// from the workspace node_modules (dev). @glb/* packages are BUNDLED (their source is .ts,
// so Vite transpiles them — do NOT externalize them or Node would try to require raw .ts).
const mainExternals = [
  'better-sqlite3',
  '@prisma/adapter-better-sqlite3',
  '@prisma/client',
  '@prisma/client/runtime/client',
  '@prisma/client/runtime/index-browser'
];

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: mainExternals
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        // Force a CommonJS preload with a .cjs extension. The app package.json is
        // "type": "module", so a plain .js preload would be parsed as ESM — which
        // Electron does not allow for a contextIsolated preload. .cjs sidesteps that.
        external: [],
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    }
  }
});
