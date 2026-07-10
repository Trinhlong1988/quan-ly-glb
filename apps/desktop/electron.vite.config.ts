import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Runtime modules that MUST stay external in the main bundle (G10: PostgreSQL).
// pg is pure-JS (no native .node addon) but pulls in Node built-ins/dynamic requires,
// so keep it + the Prisma pg adapter external; @prisma runtime is resolved at run time
// from the workspace node_modules (dev). @glb/* packages are BUNDLED (their source is .ts,
// so Vite transpiles them — do NOT externalize them or Node would try to require raw .ts).
const mainExternals = [
  'pg',
  '@prisma/adapter-pg',
  '@prisma/client',
  '@prisma/client/runtime/client',
  '@prisma/client/runtime/index-browser',
  // G11 [L1]: electron-updater phải external (không bundle) — nạp bằng dynamic require lúc chạy,
  // đọc app-update.yml trong tài nguyên đóng gói. Bundle vào sẽ vỡ resolve tài nguyên.
  'electron-updater'
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
