import { defineConfig } from 'vitest/config'

// Integration tests: real PostgreSQL, started by tests/integration/setup.ts through
// Testcontainers. No DATABASE_URL needed — the container supplies one. Serial, because
// the files share one database.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
})
