import { defineConfig } from 'vitest/config'

// Unit tests only: no database, no network.
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts'] },
})
