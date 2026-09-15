import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { createApp } from '../../../src/interface/http/app.ts'

/**
 * The contract tests validate *responses* against openapi.yaml, and they find the route by
 * operationId — so nothing checked that the path the app serves is the path the document
 * publishes. Measured: renaming the route and its test together, leaving openapi.yaml alone,
 * left all 75 integration tests green while a client following the contract would have 404'd.
 *
 * This closes that. It compares the routes Hono actually registered against the paths the
 * document declares, in both directions.
 */
const contract = parse(
  readFileSync(fileURLToPath(new URL('../../../docs/openapi.yaml', import.meta.url)), 'utf8'),
) as Record<string, unknown>

const rejects = (): Promise<never> => Promise.reject(new Error('not called'))

const app = createApp({
  useCases: {
    createProfile: rejects,
    getProfile: rejects,
    updateProfile: rejects,
    deleteProfile: rejects,
    createAvatarUpload: rejects,
  },
  logger: pino({ level: 'silent' }),
  authentication: { jwks: rejects as never, issuer: 'issuer', audience: 'audience' },
  readiness: { isDraining: () => false, canServe: () => Promise.resolve(true) },
})

/** Hono writes parameters as `:userId`; the contract writes them as `{userId}`. */
const served = new Set(
  app.routes
    .filter((route) => route.method !== 'ALL') // ALL is middleware, not an endpoint
    .map((route) => `${route.method} ${route.path.replace(/:(\w+)/g, '{$1}')}`),
)

const declared = new Set(
  Object.entries(contract['paths'] as Record<string, unknown>).flatMap(([path, item]) =>
    Object.entries(item as Record<string, unknown>)
      .filter(([, operation]) => typeof (operation as Record<string, unknown>)['operationId'] === 'string')
      .map(([method]) => `${method.toUpperCase()} ${path}`),
  ),
)

describe('the routes the app serves are the paths the contract publishes', () => {
  it('serves everything the contract declares', () => {
    expect([...declared].filter((operation) => !served.has(operation)).sort()).toEqual([])
  })

  it('declares everything the app serves', () => {
    expect([...served].filter((operation) => !declared.has(operation)).sort()).toEqual([])
  })

  it('found routes at all, so a change in how Hono reports them cannot empty this test', () => {
    expect(served.size).toBe(declared.size)
    expect(served.size).toBeGreaterThan(5)
  })
})
