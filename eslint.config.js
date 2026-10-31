import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Import zones — the dependency rule from build_plan.md, made a build failure.
 *
 *   interface/http ──► application ──► domain ◄── infrastructure
 *
 * The zones cover the four layer directories, so the files directly under `src/` sit outside
 * them: `index.ts`, the composition root and the one place that knows every layer exists, and
 * the one-shot commands `migrate.ts` and `republish-events.ts`, which compose what they need the
 * same way.
 */
const zone = (files, groups, message) => ({
  files,
  rules: {
    'no-restricted-imports': ['error', { patterns: [{ group: groups, message }] }],
  },
})

const FRAMEWORKS = ['hono', 'hono/*', '@hono/*', 'drizzle-orm', 'drizzle-orm/*', 'pg', 'zod']

/**
 * Adapters too: `jose` and `pino` belong to interface/http and the composition root, the S3 client
 * and the broker client to infrastructure.
 */
const ADAPTERS = ['jose', 'pino', 'pino/*', '@aws-sdk/*', 'amqplib']

export default tseslint.config(
  { ignores: ['node_modules/**', 'drizzle/**', 'dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  zone(
    ['src/domain/**/*.ts'],
    ['**/application/**', '**/infrastructure/**', '**/interface/**', '**/scripts/**', ...FRAMEWORKS, ...ADAPTERS],
    'domain/ imports only other domain files and Node built-ins — no framework, no ORM, no HTTP.',
  ),
  zone(
    ['src/application/**/*.ts'],
    ['**/infrastructure/**', '**/interface/**', '**/scripts/**', ...FRAMEWORKS, ...ADAPTERS],
    'application/ depends on domain/ and its repository interface — never on infrastructure or HTTP.',
  ),
  {
    files: ['src/infrastructure/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/interface/**', '**/scripts/**', 'hono', 'hono/*', '@hono/*', 'jose'],
              message: 'infrastructure/ implements ports — it does not know HTTP exists.',
            },
            {
              // A driven port may be declared in application/ when the domain has no use for it:
              // the domain never resolves a photo key. Implementing that contract is inward-
              // pointing and allowed; calling a use case is not, so only the type may cross —
              // and only from ports/, so the allowance cannot quietly widen into "any type".
              group: ['**/application/**', '!**/application/ports/**'],
              message: 'infrastructure/ implements ports — it does not call application code.',
            },
            {
              group: ['**/application/ports/**'],
              allowTypeImports: true,
              message:
                'infrastructure/ may implement a port, but must not import it as a value — the type alone.',
            },
          ],
        },
      ],
    },
  },
  zone(
    ['src/interface/**/*.ts'],
    ['**/infrastructure/**', '**/scripts/**', 'drizzle-orm', 'drizzle-orm/*', 'pg'],
    'interface/http/ talks to application/ and domain/ — never to the database directly.',
  ),
)
