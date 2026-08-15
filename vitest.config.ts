import { defineConfig } from 'vitest/config'

/** Source-plane tests: the specs import `src` directly, so a clean tree needs no build. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
