import { defineConfig } from 'drizzle-kit'

// drizzle-kit takes no --env-file flag, so load it here. Node 22 built-in, no dependency.
try {
  process.loadEnvFile('.env')
} catch {
  // no .env — the variable may already be in the environment, or this is CI
}

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
})
