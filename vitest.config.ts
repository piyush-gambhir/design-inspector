import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// WXT resolves '@' and '~' to the project root at build time. Vitest does not
// read tsconfig paths, so the same aliases are declared here; without them any
// test that reaches a module importing '@/lib/...' fails to resolve.
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${root}` },
      { find: /^~\//, replacement: `${root}` },
    ],
  },
  test: {
    // Playwright specs live in e2e/ and run under their own runner.
    dir: './__tests__',
    environment: 'jsdom',
  },
});
