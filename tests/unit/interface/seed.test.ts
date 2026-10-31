import { readdirSync, readFileSync } from 'node:fs'
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

describe('the seed runners', () => {
  it('are Identity\u2019s Ray and Mali, then the five, each under a fixed UUID in file order', () => {
    expect(seed.map((entry) => [entry.userId, entry['displayName']])).toEqual([
      ['11111111-1111-4111-8111-111111111111', 'Ray Attajak'],
      ['22222222-2222-4222-8222-222222222222', 'Mali S.'],
      ['33333333-3333-4333-8333-333333333333', 'Nok'],
      ['44444444-4444-4444-8444-444444444444', 'Beam'],
      ['55555555-5555-4555-8555-555555555555', 'Ploy'],
      ['66666666-6666-4666-8666-666666666666', 'Bank'],
      ['77777777-7777-4777-8777-777777777777', 'Ann'],
    ])
  })

  it('name every photo file for a runner who exists, so a missed rename cannot drop a photo silently', () => {
    const ids = new Set(seed.map((entry) => entry.userId))
    const files = readdirSync('scripts/avatars')
    expect(files.filter((file) => !ids.has(file.replace(/\.png$/, '')))).toEqual([])
    expect(files).toHaveLength(4)
  })
})
