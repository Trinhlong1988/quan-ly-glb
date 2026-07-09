import { defineConfig } from 'vitest/config';

// Root Vitest config — runs pure-logic tests in packages/shared + packages/business-rules.
// These packages have NO Electron/Prisma-client runtime dependency, so tests run in plain Node.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/shared/**/*.test.ts',
      'packages/business-rules/**/*.test.ts'
    ],
    reporters: ['default']
  }
});
