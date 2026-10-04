import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { Area } from '../../../src/domain/area.ts'
import { Pace } from '../../../src/domain/pace.ts'
import { PreferredRunTime } from '../../../src/domain/preferred-run-time.ts'
import { Volume } from '../../../src/domain/volume.ts'
import { PreferredDistance } from '../../../src/domain/preferred-distance.ts'
import { Profile } from '../../../src/domain/profile.ts'
import {
  profileDeleted,
  profileUpdated,
  publicProfile,
} from '../../../src/infrastructure/profile-published-language.ts'

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

const nok = new Profile({
  userId: '7f3a9c2e15',
  displayName: 'Nok',
  birthYear: 1994,
  area: new Area(13.731723456, 100.541532),
  pace: new Pace(330),
  preferredDistances: [new PreferredDistance('10k')],
  preferredRunTimes: [],
})

describe('ProfileUpdated', () => {
  it('travels in a CloudEvents 1.0 envelope that names the runner and the version', () => {
    const event = profileUpdated(nok, at, 'event-1')

    expect(event).toMatchObject({
      specversion: '1.0',
      id: 'event-1',
      source: 'profile-service',
      type: 'ProfileUpdated',
      time: '2026-10-04T11:20:00.000Z',
      subject: '7f3a9c2e15',
      datacontenttype: 'application/json',
      dataschema: 'urn:cant-run-alone:profile-service:ProfileUpdated:1',
    })
  })

  it('gives every event its own id when none is given', () => {
    expect(profileUpdated(nok).id).not.toBe(profileUpdated(nok).id)
  })

  it('carries the area only as its cell — the exact point never leaves (NFR-4.1)', () => {
    const event = profileUpdated(nok, at)

    expect(event.data?.['areaCell']).toEqual({ latitude: 13.73, longitude: 100.54 })
    expect('area' in (event.data ?? {})).toBe(false)
    expect(JSON.stringify(event)).not.toContain('13.731723456')
    expect(JSON.stringify(event)).not.toContain('100.541532')
  })

  it('leaves an unset scalar out and an unset set empty, as the API does', () => {
    const data = publicProfile(nok)

    expect('bio' in data).toBe(false)
    expect(data['pace']).toBe(330)
    expect(data['preferredRunTimes']).toEqual([])
  })

  it('obeys the ProfileUpdatedEvent schema in openapi.yaml', () => {
    const validate = schema('ProfileUpdatedEvent')
    expect(validate(profileUpdated(nok, at)), ajv.errorsText(validate.errors)).toBe(true)
  })

  it('obeys that schema with every optional field set, not only a sparse profile', () => {
    const everything = new Profile({
      userId: '7f3a9c2e15',
      displayName: 'Nok',
      bio: 'Chasing a sub-2 half.',
      avatarRef: 'avatars/7f3a9c2e15/abc',
      birthYear: 1994,
      gender: 'female',
      area: new Area(13.731723456, 100.541532),
      pace: new Pace(330),
      volume: new Volume(42_000),
      experience: 'intermediate',
      preferredDistances: [new PreferredDistance('10k'), new PreferredDistance('half_marathon')],
      preferredRunTimes: [new PreferredRunTime('tue', 'early_morning')],
    })
    const validate = schema('ProfileUpdatedEvent')
    expect(validate(profileUpdated(everything, at)), ajv.errorsText(validate.errors)).toBe(true)
  })

  it('is refused by that schema when `time` is not an RFC 3339 UTC timestamp', () => {
    expect(schema('ProfileUpdatedEvent')({ ...profileUpdated(nok, at), time: 'not-a-date' })).toBe(false)
    expect(schema('ProfileUpdatedEvent')({ ...profileUpdated(nok, at), time: '2026-10-04 11:20' })).toBe(false)
  })

  it('is refused by that schema if an exact area ever slips in', () => {
    const leaky = profileUpdated(nok, at)
    const data = { ...leaky.data, area: { latitude: 13.731723456, longitude: 100.541532 } }
    expect(schema('ProfileUpdatedEvent')({ ...leaky, data })).toBe(false)
  })
})

describe('ProfileDeleted', () => {
  it('names the runner and carries no data', () => {
    const event = profileDeleted('7f3a9c2e15', at, 'event-2')

    expect(event).toMatchObject({
      specversion: '1.0',
      id: 'event-2',
      source: 'profile-service',
      type: 'ProfileDeleted',
      subject: '7f3a9c2e15',
      dataschema: 'urn:cant-run-alone:profile-service:ProfileDeleted:1',
    })
    expect('data' in event).toBe(false)
    expect('datacontenttype' in event).toBe(false)
  })

  it('obeys the ProfileDeletedEvent schema in openapi.yaml', () => {
    const validate = schema('ProfileDeletedEvent')
    expect(validate(profileDeleted('7f3a9c2e15', at)), ajv.errorsText(validate.errors)).toBe(true)
  })
})
