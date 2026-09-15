import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/**
 * The README lists the endpoints because "what does this service do?" is the first thing anyone
 * asks, and answering it should not require opening a 250-line contract.
 *
 * But that makes the README a second home for a fact, which is how documents start lying. So it
 * is checked against `openapi.yaml` the same way responses are — on every run.
 */
const root = (path: string): string => fileURLToPath(new URL(`../../../${path}`, import.meta.url))

type Node = Record<string, unknown>
const contract = parse(readFileSync(root('docs/openapi.yaml'), 'utf8')) as Node
const readme = readFileSync(root('README.md'), 'utf8')

const declared = Object.entries(contract['paths'] as Node).flatMap(([path, item]) =>
  Object.entries(item as Node)
    .filter(([, operation]) => typeof (operation as Node)['operationId'] === 'string')
    .map(([method]) => `${method.toUpperCase()} ${path}`),
)

/** Rows shaped `| GET | /health | … |`, with {userId} written the way the contract writes it. */
const listed = [...readme.matchAll(/^\|\s*`([A-Z]+)`\s*\|\s*`([^`]+)`\s*\|/gm)].map(
  ([, method, path]) => `${method as string} ${path as string}`,
)

describe('the README lists what the contract declares', () => {
  it('leaves nothing out', () => {
    expect(declared.filter((operation) => !listed.includes(operation))).toEqual([])
  })

  it('invents nothing', () => {
    expect(listed.filter((operation) => !declared.includes(operation))).toEqual([])
  })

  it('finds them at all, so a formatting change cannot quietly empty this test', () => {
    expect(listed.length).toBe(declared.length)
    expect(listed.length).toBeGreaterThan(5)
  })
})
