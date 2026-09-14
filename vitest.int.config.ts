import { defineConfig } from 'vitest/config'

// Integration tests: real PostgreSQL. Serial, because they share one database.
// vitest takes no --env-file flag either, so DATABASE_URL comes from .env here.
try {
  process.loadEnvFile('.env')
} catch {
  // no .env — the variable may already be in the environment, or this is CI
}

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
