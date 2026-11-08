import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const tag = (file: string, pattern: RegExp): string | undefined => readFileSync(file, 'utf8').match(pattern)?.[1]

const compose = tag('docker-compose.yml', /image:\s*postgres:(\S+)/)
const integration = tag('tests/integration/setup.ts', /POSTGRES_IMAGE = 'postgres:([^']+)'/)
const component = tag('tests/component/stack.ts', /POSTGRES_IMAGE = 'postgres:([^']+)'/)

describe('the PostgreSQL image', () => {
  it('is the major version ADR-0015 names: PostgreSQL 16', () => {
    expect(compose).toMatch(/^16[.-]/)
  })

  it('is the same for development and for the integration suite, which must move together', () => {
    expect(integration).toBe(compose)
  })

  it('is the same for the component suite, which runs the image beside it', () => {
    expect(component).toBe(compose)
  })
})
