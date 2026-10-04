import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Profile } from '../../../src/domain/profile.ts'
import { toFields } from '../../../src/interface/http/profile-input.ts'
import { profileWrite } from '../../../src/interface/http/validators.ts'

type Entry = Record<string, unknown> & { userId: string }
const seed = JSON.parse(readFileSync('scripts/seed.json', 'utf8')) as Entry[]

/** `db:seed` builds each runner through the API's own parsing, so a stale fixture fails here first. */
describe('scripts/seed.json', () => {
  it.each(seed.map((entry) => [entry.userId, entry] as const))('%s is a profile the API would accept', (userId, entry) => {
    const body = Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'userId'))
    expect(() => new Profile(toFields(userId, profileWrite.parse(body)))).not.toThrow()
  })
})
