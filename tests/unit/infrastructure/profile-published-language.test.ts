import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { Area } from '../../../src/domain/area.ts'
import { HIDEABLE_FIELDS } from '../../../src/domain/hidden-field.ts'
import { PaceRange } from '../../../src/domain/pace-range.ts'
import { PreferredRunTime } from '../../../src/domain/preferred-run-time.ts'
import { Profile, type ProfileFields } from '../../../src/domain/profile.ts'
import { UsualDistance } from '../../../src/domain/usual-distance.ts'
import { matching, profileUpdated } from '../../../src/infrastructure/profile-published-language.ts'
import { toView } from '../../../src/interface/http/profile-view.ts'

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

const nokFields: ProfileFields = {
  userId: '7f3a9c2e15',
  displayName: 'Nok',
  birthYear: 1994,
  area: new Area(13.731723456, 100.541532),
  paceRange: new PaceRange(330, 390),
  preferredRunTimes: [],
  gear: ['Pegasus 41'],
  hiddenFields: [],
}
const nok = new Profile(nokFields)

const everythingFields: ProfileFields = {
  userId: '7f3a9c2e15',
  displayName: 'Nok',
  bio: 'Chasing a sub-2 half.',
  avatarRef: 'avatars/7f3a9c2e15/abc',
  birthYear: 1994,
  gender: 'female',
  area: new Area(13.731723456, 100.541532),
  paceRange: new PaceRange(330, 390),
  usualDistance: new UsualDistance(10_000),
  experience: 'intermediate',
  preferredRunTimes: [new PreferredRunTime('tue', 'early_morning')],
  gear: ['Pegasus 41', 'Forerunner 265'],
  hiddenFields: [],
}
const everything = new Profile(everythingFields)

type Data = { card: Record<string, unknown>; matching: Record<string, unknown> }
const dataOf = (profile: Profile): Data => profileUpdated(profile, at).data as Data

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
    const { card } = dataOf(nok)

    expect(card['areaCell']).toEqual({ latitude: 13.73, longitude: 100.54 })
    expect('area' in card).toBe(false)
    expect(JSON.stringify(event)).not.toContain('13.731723456')
    expect(JSON.stringify(event)).not.toContain('100.541532')
  })

  it('carries the public card exactly as another runner gets it from the API', () => {
    const hiding = new Profile({ ...nokFields, hiddenFields: ['paceRange', 'gear'] })
    for (const profile of [nok, hiding, everything]) {
      expect(dataOf(profile).card).toEqual(toView(profile, 'others'))
    }
  })

  it('leaves hidden fields off the card but keeps the matching fields in matching', () => {
    const hiding = new Profile({
      ...nokFields,
      experience: 'intermediate',
      hiddenFields: ['paceRange', 'experience', 'preferredRunTimes'],
    })
    const data = dataOf(hiding)

    expect('paceRange' in data.card).toBe(false)
    expect('experience' in data.card).toBe(false)
    expect('preferredRunTimes' in data.card).toBe(false)
    expect(data.matching).toEqual({
      paceRange: { fastest: 330, slowest: 390 },
      experience: 'intermediate',
      preferredRunTimes: [],
    })
  })

  it('never puts a hidden field that nothing matches on anywhere in the event', () => {
    const hiding = new Profile({
      ...everythingFields,
      hiddenFields: ['bio', 'birthYear', 'gender', 'usualDistance', 'gear'],
    })
    const text = JSON.stringify(profileUpdated(hiding, at, 'event-3'))
    for (const leaked of ['Chasing a sub-2 half.', '1994', 'female', '10000', 'Forerunner 265']) {
      expect(text).not.toContain(leaked)
    }
  })

  it('leaves a hidden and unset pace range out of matching, not null', () => {
    const sparse = new Profile({
      userId: '7f3a9c2e15',
      displayName: 'Nok',
      area: new Area(13.731723456, 100.541532),
      preferredRunTimes: [],
      gear: [],
      hiddenFields: ['paceRange'],
    })
    expect('paceRange' in matching(sparse)).toBe(false)
    expect(matching(sparse)).toEqual({ preferredRunTimes: [] })
  })

  it('obeys the ProfileUpdatedEvent schema in openapi.yaml', () => {
    const validate = schema('ProfileUpdatedEvent')
    expect(validate(profileUpdated(nok, at)), ajv.errorsText(validate.errors)).toBe(true)
  })

  it('obeys that schema with every optional field set, and with every field hidden', () => {
    const validate = schema('ProfileUpdatedEvent')
    const allHidden = new Profile({ ...everythingFields, hiddenFields: [...HIDEABLE_FIELDS] })
    expect(validate(profileUpdated(everything, at)), ajv.errorsText(validate.errors)).toBe(true)
    expect(validate(profileUpdated(allHidden, at)), ajv.errorsText(validate.errors)).toBe(true)
  })

  it('is refused by that schema when `time` is not an RFC 3339 UTC timestamp', () => {
    expect(schema('ProfileUpdatedEvent')({ ...profileUpdated(nok, at), time: 'not-a-date' })).toBe(false)
    expect(schema('ProfileUpdatedEvent')({ ...profileUpdated(nok, at), time: '2026-10-04 11:20' })).toBe(false)
  })

  it('is refused by that schema if an exact area ever slips into the card', () => {
    const leaky = profileUpdated(nok, at)
    const { card, matching: matched } = leaky.data as Data
    const data = { card: { ...card, area: { latitude: 13.731723456, longitude: 100.541532 } }, matching: matched }
    expect(schema('ProfileUpdatedEvent')({ ...leaky, data })).toBe(false)
  })

  it('is refused by that schema if the hidden set ever slips into the card', () => {
    const leaky = profileUpdated(nok, at)
    const { card, matching: matched } = leaky.data as Data
    const data = { card: { ...card, hiddenFields: ['gear'] }, matching: matched }
    expect(schema('ProfileUpdatedEvent')({ ...leaky, data })).toBe(false)
  })
})
