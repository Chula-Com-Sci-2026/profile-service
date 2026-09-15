import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../../src/infrastructure/config.ts'

/**
 * `.env.example` is the only instruction a teammate gets before their first run, and it drifts
 * silently: a setting added to `config.ts` and forgotten here costs them a failed startup and a
 * read of the source to work out why. Nothing else in the suite would notice.
 *
 * So the file is checked the way `openapi.yaml` is — against the code, on every run.
 */
const root = (path: string): string => fileURLToPath(new URL(`../../../${path}`, import.meta.url))

const example = readFileSync(root('.env.example'), 'utf8')
const configSource = readFileSync(root('src/infrastructure/config.ts'), 'utf8')

const documented = [...example.matchAll(/^([A-Z_]+)=(.*)$/gm)].map(([, name, value]) => ({
  name: name as string,
  value: value as string,
}))
const read = [...configSource.matchAll(/read\(env, '([A-Z_]+)'\)/g)].map(([, name]) => name as string)

/** Everything above the "optional" heading claims to be required. */
const optionalHeading = example.indexOf('─── optional')
const claimedRequired = new Set(
  [...example.slice(0, optionalHeading).matchAll(/^([A-Z_]+)=/gm)].map(([, name]) => name),
)

const complete = Object.fromEntries(documented.map(({ name, value }) => [name, value]))

/** Does the service refuse to start without it? */
function isRequired(name: string): boolean {
  const without = { ...complete }
  delete without[name]
  try {
    loadConfig(without)
    return false
  } catch {
    return true
  }
}

describe('.env.example covers what the service reads', () => {
  it('documents every setting config.ts asks for', () => {
    const names = new Set(documented.map(({ name }) => name))
    expect([...new Set(read)].filter((name) => !names.has(name))).toEqual([])
  })

  it('documents nothing the service ignores', () => {
    const asked = new Set(read)
    expect(documented.map(({ name }) => name).filter((name) => !asked.has(name))).toEqual([])
  })
})

describe('.env.example tells the truth about what is required', () => {
  it.each(documented.map(({ name }) => name))('puts %s in the honest section', (name) => {
    expect({ name, required: isRequired(name) }).toEqual({
      name,
      required: claimedRequired.has(name),
    })
  })

  it('states a default for every optional setting', () => {
    const optional = example.slice(optionalHeading)
    for (const { name } of documented.filter(({ name }) => !claimedRequired.has(name))) {
      const declaredAt = optional.indexOf(`${name}=`)
      const precedingComments = optional.slice(0, declaredAt)
      expect(precedingComments.slice(precedingComments.lastIndexOf('\n\n'))).toMatch(/default:/)
    }
  })
})

describe('.env.example works', () => {
  it('loads as written, so copying it to .env is enough to start', () => {
    const config = loadConfig(complete)
    expect(config.port).toBe(3000)
    expect(config.objectStorage.bucket).toBe('profile-service')
  })
})
