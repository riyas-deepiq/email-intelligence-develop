import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve('../client/src'), vitest: path.resolve('node_modules/vitest') },
  },
  test: { environment: 'node', include: ['../client/tests/org-hierarchy.test.ts'] },
});
