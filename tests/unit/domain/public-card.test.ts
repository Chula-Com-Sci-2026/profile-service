import { describe, expect, it } from 'vitest'
import { HIDEABLE_FIELDS, type HiddenField } from '../../../src/domain/hidden-field.ts'
import { Profile, type ProfileFields } from '../../../src/domain/profile.ts'

const RAY = '11111111-1111-4111-8111-111111111111'
const PHOTO = `photos/${RAY}/0b5f3c1e-7d2a-4e9b-8f61-2c4d6e8a0b1c`

/** Every field set, nothing hidden — so a card can only be missing what was hidden. */
function everything(overrides: Partial<ProfileFields> = {}): Profile {
  return new Profile({
    id: RAY,
    name: 'Ray Attajak',
    bio: 'Chasing a sub-2 half.',
    paceMin: 6,
    paceMax: 6.5,
    experience: 'Intermediate',
    area: 'Lumphini area',
    latitude: 13.731723456,
    longitude: 100.541532,
    availability: 'Tue & Thu evenings',
    usualDistance: '5–10 km',
    gear: ['Pegasus 41'],
    photoRef: PHOTO,
    hiddenFields: [],
    ...overrides,
  })
}

/** The keys a hideable name nulls on the card. */
const KEYS: Record<HiddenField, readonly string[]> = {
  bio: ['bio'],
  pace: ['paceMin', 'paceMax'],
  availability: ['availability'],
  experience: ['experience'],
  usualDistance: ['usualDistance'],
  gear: ['gear'],
}

describe('Profile.publicCard — what other runners see', () => {
  it('has exactly the card’s keys, every one always present', () => {
    expect(Object.keys(everything().publicCard()).sort()).toEqual(
      ['area', 'areaCell', 'availability', 'bio', 'experience', 'gear', 'id', 'name', 'paceMax', 'paceMin', 'photoRef', 'usualDistance'].sort(),
    )
  })

  it('shows every set field when nothing is hidden, the point only as its cell', () => {
    const card = everything().publicCard()
    expect(card).toMatchObject({
      id: RAY,
      name: 'Ray Attajak',
      area: 'Lumphini area',
      photoRef: PHOTO,
      bio: 'Chasing a sub-2 half.',
      paceMin: 6,
      paceMax: 6.5,
      experience: 'Intermediate',
      availability: 'Tue & Thu evenings',
      usualDistance: '5–10 km',
      gear: ['Pegasus 41'],
    })
    expect(card.areaCell).toMatchObject({ latitude: 13.73, longitude: 100.54 })
  })

  it.each(HIDEABLE_FIELDS.map((field) => [field]))('nulls %s when it is hidden, and nothing else', (field) => {
    const card = everything({ hiddenFields: [field] }).publicCard() as Record<string, unknown>
    for (const key of KEYS[field]) expect(card[key]).toBeNull()
    const others = Object.values(KEYS).flat().filter((key) => !KEYS[field].includes(key))
    for (const key of others) expect(card[key]).not.toBeNull()
  })

  it('hides both ends of the pace with one name', () => {
    const card = everything({ hiddenFields: ['pace'] }).publicCard()
    expect([card.paceMin, card.paceMax]).toEqual([null, null])
  })

  it('shows hidden gear as null, never []', () => {
    expect(everything({ hiddenFields: ['gear'] }).publicCard().gear).toBeNull()
  })

  it('shows unset fields as null too', () => {
    const card = everything({ bio: null, usualDistance: null, gear: null, photoRef: null }).publicCard()
    expect([card.bio, card.usualDistance, card.gear, card.photoRef]).toEqual([null, null, null, null])
  })

  it('never nulls the id, the name, the area, the cell or the photo, whatever is hidden', () => {
    const card = everything({ hiddenFields: [...HIDEABLE_FIELDS] }).publicCard()
    expect(card.id).toBe(RAY)
    expect(card.name).toBe('Ray Attajak')
    expect(card.area).toBe('Lumphini area')
    expect(card.areaCell).not.toBeNull()
    expect(card.photoRef).toBe(PHOTO)
  })

  it('never carries the exact point or the hidden set', () => {
    const card = everything({ hiddenFields: ['bio'] }).publicCard()
    expect('latitude' in card).toBe(false)
    expect('longitude' in card).toBe(false)
    expect('hiddenFields' in card).toBe(false)
    expect(JSON.stringify(card)).not.toContain('13.731723456')
  })

  it('keeps a field hidden that was hidden while unset, once a save sets it', () => {
    const before = everything({ usualDistance: null, hiddenFields: ['usualDistance'] })
    const after = before.save({
      name: 'Ray Attajak',
      paceMin: 6,
      paceMax: 6.5,
      experience: 'Intermediate',
      area: 'Lumphini area',
      latitude: 13.731723456,
      longitude: 100.541532,
      availability: 'Tue & Thu evenings',
      usualDistance: 'Over 10 km',
    })
    expect(after.usualDistance).toBe('Over 10 km')
    expect(after.publicCard().usualDistance).toBeNull()
  })

  it('is frozen', () => {
    expect(Object.isFrozen(everything().publicCard())).toBe(true)
  })
})
