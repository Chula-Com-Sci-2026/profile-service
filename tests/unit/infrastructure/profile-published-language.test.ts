import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { HIDEABLE_FIELDS } from '../../../src/domain/hidden-field.ts'
import { Profile, type ProfileFields } from '../../../src/domain/profile.ts'
import { profileUpdated, type ProfileUpdatedEvent } from '../../../src/infrastructure/profile-published-language.ts'
import { cardView } from '../../../src/interface/http/profile-view.ts'
import { eventSchema, expectProfileEvent, obeysEventSchema } from './event-contract.ts'

/**
 * The events are a published contract, so they are checked against `docs/profile-events.schema.json`
 * the way responses are checked against openapi.yaml: the code obeys the document, never the
 * reverse.
 */
type Node = Record<string, unknown>

const at = new Date('2026-10-04T11:20:00.000Z')
const RAY = '11111111-1111-4111-8111-111111111111'
const EVENT = '5f0c7a8e-3b1d-4e2a-9c6f-0d8b7a6e5c4d'
const CORRELATION = 'abcdef01-2345-4678-89ab-cdef01234567'
const meta = { eventId: EVENT, occurredAt: at, correlationId: CORRELATION }
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
  revision: 1,
}
const minimal = new Profile(minimalFields)
const everything = new Profile({
  ...minimalFields,
  bio: 'Chasing a sub-2 half.',
  usualDistance: '5–10 km',
  gear: ['Pegasus 41', 'Forerunner 265'],
  photoRef: PHOTO,
  revision: 7,
})
const hiding = new Profile({ ...everything, hiddenFields: ['pace', 'gear'] } as ProfileFields)
const allHidden = new Profile({ ...everything, hiddenFields: [...HIDEABLE_FIELDS] } as ProfileFields)

const event = (profile: Profile): ProfileUpdatedEvent => profileUpdated(profile, photoUrl, meta)
const without = (node: Node, key: string): Node => Object.fromEntries(Object.entries(node).filter(([name]) => name !== key))

describe('ProfileUpdated', () => {
  it('travels in events.md’s envelope — those six keys and no others', () => {
    const sent = event(minimal)
    expect(Object.keys(sent)).toEqual(['eventId', 'eventType', 'version', 'occurredAt', 'correlationId', 'payload'])
    expect(sent).toMatchObject({
      eventId: EVENT,
      eventType: 'ProfileUpdated',
      version: 1,
      occurredAt: '2026-10-04T11:20:00.000Z',
      correlationId: CORRELATION,
    })
  })

  it('carries the public card exactly as the API serialises it, plus the revision', () => {
    for (const profile of [minimal, hiding, everything]) {
      expect(event(profile).payload).toEqual({ ...cardView(profile.publicCard(), photoUrl), revision: profile.revision })
    }
  })

  it('carries the point only as its cell — the exact point never leaves (NFR-4.1)', () => {
    const { payload } = event(minimal)
    expect(payload['areaCell']).toEqual({ latitude: 13.73, longitude: 100.54 })
    expect('latitude' in payload).toBe(false)
    const text = JSON.stringify(event(minimal))
    expect(text).not.toContain('13.731723456')
    expect(text).not.toContain('100.541532')
  })

  it('carries hidden fields as null, and none of their values anywhere', () => {
    const { payload } = event(hiding)
    expect([payload['paceMin'], payload['paceMax'], payload['gear']]).toEqual([null, null, null])
    const text = JSON.stringify(event(hiding))
    for (const leaked of ['Pegasus 41', 'Forerunner 265', '6.5']) expect(text).not.toContain(leaked)
  })

  it('carries the photo as its public address', () => {
    expect(event(everything).payload['photoUrl']).toBe(photoUrl(PHOTO))
    expect(event(minimal).payload['photoUrl']).toBeNull()
  })

  it('obeys docs/profile-events.schema.json — minimal, with everything, and with everything hidden', () => {
    for (const profile of [minimal, everything, allHidden]) expectProfileEvent(event(profile))
  })

  it.each([
    ['occurredAt is not a date-time', (e: Node) => ({ ...e, occurredAt: '2026-10-04 11:20' })],
    ['eventId is not a UUID', (e: Node) => ({ ...e, eventId: 'event-1' })],
    ['version is 2', (e: Node) => ({ ...e, version: 2 })],
    ['eventType is another event', (e: Node) => ({ ...e, eventType: 'ProfileDeleted' })],
    ['a CloudEvents key is left in', (e: Node) => ({ ...e, specversion: '1.0' })],
    ['revision is 0', (e: Node) => ({ ...e, payload: { ...(e['payload'] as Node), revision: 0 } })],
    ['revision is missing', (e: Node) => ({ ...e, payload: without(e['payload'] as Node, 'revision') })],
    ['an exact point slips into the payload', (e: Node) => ({ ...e, payload: { ...(e['payload'] as Node), latitude: 13.731723456 } })],
    ['the hidden set slips into the payload', (e: Node) => ({ ...e, payload: { ...(e['payload'] as Node), hiddenFields: ['gear'] } })],
    ['a card key goes missing — every key is always present', (e: Node) => ({ ...e, payload: without(e['payload'] as Node, 'bio') })],
    ['gear is [] — no gear is null', (e: Node) => ({ ...e, payload: { ...(e['payload'] as Node), gear: [] } })],
    ['the id is in uppercase', (e: Node) => ({ ...e, payload: { ...(e['payload'] as Node), id: 'ABCDEF01-2345-4678-89AB-CDEF01234567' } })],
  ])('is refused by that schema if %s', (_, change) => {
    const sent = event(everything) as unknown as Node
    expect(obeysEventSchema(sent)).toBe(true)
    expect(obeysEventSchema(change(sent))).toBe(false)
  })

  it('names exactly the public card’s keys in openapi.yaml, plus revision — so the two documents cannot drift apart', () => {
    const openapi = parse(readFileSync('docs/openapi.yaml', 'utf8')) as Node
    const publicCard = ((openapi['components'] as Node)['schemas'] as Node)['PublicCard'] as { properties: Node; required: string[] }
    const payload = (eventSchema['properties'] as Node)['payload'] as { properties: Node; required: string[] }

    expect(Object.keys(payload.properties).sort()).toEqual([...Object.keys(publicCard.properties), 'revision'].sort())
    expect([...payload.required].sort()).toEqual([...publicCard.required, 'revision'].sort())
  })
})
