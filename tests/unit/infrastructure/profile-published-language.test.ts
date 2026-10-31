import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { HIDEABLE_FIELDS } from '../../../src/domain/hidden-field.ts'
import { Profile, type ProfileFields } from '../../../src/domain/profile.ts'
import { profileUpdated } from '../../../src/infrastructure/profile-published-language.ts'
import { cardView } from '../../../src/interface/http/profile-view.ts'

/**
 * The events are a published contract (ADR-0019), so they are checked against openapi.yaml's
 * webhook schemas the way responses are checked by the contract oracle: the code obeys the
 * document, never the reverse.
 */
const document = parse(readFileSync('docs/openapi.yaml', 'utf8')) as object
const ajv = new Ajv2020({ strict: false, allErrors: true })
ajv.addSchema(document, 'openapi.yaml')
const schema = (name: string) => ajv.compile({ $ref: `openapi.yaml#/components/schemas/${name}` })

const at = new Date('2026-10-04T11:20:00.000Z')
const RAY = '11111111-1111-4111-8111-111111111111'
const PHOTO = `photos/${RAY}/0b5f3c1e-7d2a-4e9b-8f61-2c4d6e8a0b1c`
const photoUrl = (photoRef: string): string => `http://localhost:9000/profile-service/${photoRef}`

const minimalFields: ProfileFields = {
  id: RAY,
  name: 'Ray Attajak',
  bio: null,
  paceMin: 6,
  paceMax: 6.5,
  experience: 'Intermediate',
  area: 'Lumphini area',
  latitude: 13.731723456,
  longitude: 100.541532,
  availability: 'Tue & Thu evenings',
  usualDistance: null,
  gear: null,
  photoRef: null,
  hiddenFields: [],
}
const minimal = new Profile(minimalFields)
const everything = new Profile({
  ...minimalFields,
  bio: 'Chasing a sub-2 half.',
  usualDistance: '5–10 km',
  gear: ['Pegasus 41', 'Forerunner 265'],
  photoRef: PHOTO,
})
const hiding = new Profile({ ...everything, hiddenFields: ['pace', 'gear'] } as ProfileFields)

type Data = { card: Record<string, unknown> }
const dataOf = (profile: Profile): Data => profileUpdated(profile, photoUrl, at).data as Data

describe('ProfileUpdated', () => {
  it('travels in a CloudEvents 1.0 envelope that names the runner and the version', () => {
    expect(profileUpdated(minimal, photoUrl, at, 'event-1')).toMatchObject({
      specversion: '1.0',
      id: 'event-1',
      source: 'profile-service',
      type: 'ProfileUpdated',
      time: '2026-10-04T11:20:00.000Z',
      subject: RAY,
      datacontenttype: 'application/json',
      dataschema: 'urn:cant-run-alone:profile-service:ProfileUpdated:2',
    })
  })

  it('gives every event its own id when none is given', () => {
    expect(profileUpdated(minimal, photoUrl).id).not.toBe(profileUpdated(minimal, photoUrl).id)
  })

  it('carries the point only as its cell — the exact point never leaves (NFR-4.1)', () => {
    const { card } = dataOf(minimal)
    expect(card['areaCell']).toEqual({ latitude: 13.73, longitude: 100.54 })
    expect('latitude' in card).toBe(false)
    const text = JSON.stringify(profileUpdated(minimal, photoUrl, at))
    expect(text).not.toContain('13.731723456')
    expect(text).not.toContain('100.541532')
  })

  it('carries the public card exactly as the API serialises it', () => {
    for (const profile of [minimal, hiding, everything]) {
      expect(dataOf(profile).card).toEqual(cardView(profile.publicCard(), photoUrl))
    }
  })

  it('carries hidden fields as null, and none of their values anywhere', () => {
    const { card } = dataOf(hiding)
    expect([card['paceMin'], card['paceMax'], card['gear']]).toEqual([null, null, null])
    const text = JSON.stringify(profileUpdated(hiding, photoUrl, at))
    for (const leaked of ['Pegasus 41', 'Forerunner 265', '6.5']) expect(text).not.toContain(leaked)
  })

  it('carries the photo as its public address', () => {
    expect(dataOf(everything).card['photoUrl']).toBe(photoUrl(PHOTO))
    expect(dataOf(minimal).card['photoUrl']).toBeNull()
  })

  it('obeys the ProfileUpdatedEvent schema in openapi.yaml — minimal, with everything, and with everything hidden', () => {
    const validate = schema('ProfileUpdatedEvent')
    const allHidden = new Profile({ ...everything, hiddenFields: [...HIDEABLE_FIELDS] } as ProfileFields)
    for (const profile of [minimal, everything, allHidden]) {
      expect(validate(profileUpdated(profile, photoUrl, at)), ajv.errorsText(validate.errors)).toBe(true)
    }
  })

  it('is refused by that schema when `time` is not an RFC 3339 UTC timestamp', () => {
    const validate = schema('ProfileUpdatedEvent')
    expect(validate({ ...profileUpdated(minimal, photoUrl, at), time: 'not-a-date' })).toBe(false)
    expect(validate({ ...profileUpdated(minimal, photoUrl, at), time: '2026-10-04 11:20' })).toBe(false)
  })

  it.each([
    ['an exact point slips into the card', (card: Record<string, unknown>) => ({ ...card, latitude: 13.731723456 })],
    ['the hidden set slips into the card', (card: Record<string, unknown>) => ({ ...card, hiddenFields: ['gear'] })],
    ['a key goes missing — every key is always present', (card: Record<string, unknown>) => Object.fromEntries(Object.entries(card).filter(([key]) => key !== 'bio'))],
    ['gear is [] — no gear is null', (card: Record<string, unknown>) => ({ ...card, gear: [] })],
  ])('is refused by that schema if %s', (_, change) => {
    const event = profileUpdated(everything, photoUrl, at)
    const data = { card: change((event.data as Data).card) }
    expect(schema('ProfileUpdatedEvent')({ ...event, data })).toBe(false)
  })
})
