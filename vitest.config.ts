import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    // Unit tests are colocated as *.test.ts; e2e (Playwright) lives in tests/ and runs separately.
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', 'tests/**'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
})
