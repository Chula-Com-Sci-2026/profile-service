import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Import zones — the dependency rule from build_plan.md, made a build failure.
 *
 *   interface/http ──► application ──► domain ◄── infrastructure
 *
 * Only `src/index.ts`, the composition root, may reach across zones: it is the
 * one place that knows every layer exists.
 */
const zone = (files, groups, message) => ({
  files,
  rules: {
    'no-restricted-imports': ['error', { patterns: [{ group: groups, message }] }],
  },
})

const FRAMEWORKS = ['hono', 'hono/*', '@hono/*', 'drizzle-orm', 'drizzle-orm/*', 'pg', 'zod']

/** Auth and object storage are adapters too: `jose` belongs to interface/http, the S3 client to infrastructure. */
const ADAPTERS = ['jose', '@aws-sdk/*']

export default tseslint.config(
  { ignores: ['node_modules/**', 'drizzle/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  zone(
    ['src/domain/**/*.ts'],
    ['**/application/**', '**/infrastructure/**', '**/interface/**', ...FRAMEWORKS, ...ADAPTERS],
    'domain/ imports only other domain files and Node built-ins — no framework, no ORM, no HTTP.',
  ),
  zone(
    ['src/application/**/*.ts'],
    ['**/infrastructure/**', '**/interface/**', ...FRAMEWORKS, ...ADAPTERS],
    'application/ depends on domain/ and its repository interface — never on infrastructure or HTTP.',
  ),
  zone(
    ['src/infrastructure/**/*.ts'],
    ['**/application/**', '**/interface/**', 'hono', 'hono/*', '@hono/*', 'jose'],
    'infrastructure/ implements domain interfaces — it does not know the application or HTTP exists.',
  ),
  zone(
    ['src/interface/**/*.ts'],
    ['**/infrastructure/**', 'drizzle-orm', 'drizzle-orm/*', 'pg'],
    'interface/http/ talks to application/ and domain/ — never to the database directly.',
  ),
)
