import { describe, expect, it } from 'vitest'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import type { HiddenField } from '../../../src/domain/hidden-field.ts'
import { Profile, type ProfileContent, type ProfileFields } from '../../../src/domain/profile.ts'

const RAY = '11111111-1111-4111-8111-111111111111'
const PHOTO = `photos/${RAY}/0b5f3c1e-7d2a-4e9b-8f61-2c4d6e8a0b1c`

/** What a save carries: Ray's answers, with overrides. */
const content = (overrides: Partial<ProfileContent> = {}): ProfileContent => ({
  name: 'Ray Attajak',
  paceMin: 6,
  paceMax: 6.5,
  experience: 'Intermediate',
  area: 'Lumphini area',
  latitude: 13.7308,
  longitude: 100.5418,
  availability: 'Tue & Thu evenings',
  ...overrides,
})

/** A profile carrying only what §3 requires; every optional field unset. Overrides add the rest. */
function fields(overrides: Partial<ProfileFields> = {}): ProfileFields {
  return {
    id: RAY,
    name: 'Ray Attajak',
    bio: null,
    paceMin: 6,
    paceMax: 6.5,
    experience: 'Intermediate',
    area: 'Lumphini area',
    latitude: 13.7308,
    longitude: 100.5418,
    availability: 'Tue & Thu evenings',
    usualDistance: null,
    gear: null,
    photoRef: null,
    hiddenFields: [],
    revision: 1,
    ...overrides,
  }
}

const aProfile = (overrides: Partial<ProfileFields> = {}): Profile => new Profile(fields(overrides))

/** The field an InvalidProfileFieldError names, or undefined when nothing was thrown. */
function refusedField(overrides: Partial<ProfileFields>): string | undefined {
  try {
    aProfile(overrides)
    return undefined
  } catch (error) {
    if (error instanceof InvalidProfileFieldError) return error.field
    throw error
  }
}

describe('Profile — id (§4: a UUID, in lowercase)', () => {
  it('is the runner’s id', () => {
    expect(aProfile().id).toBe(RAY)
  })

  it.each(['7f3a9c2e15', 'ABCDEF01-2345-4678-89AB-CDEF01234567', '', `${RAY} `])('refuses %j', (id) => {
    expect(refusedField({ id })).toBe('id')
  })
})

describe('Profile — text fields, measured after trimming', () => {
  it.each([
    ['name', 80],
    ['area', 100],
    ['availability', 120],
  ] as const)('accepts a %s of %i characters and refuses one more', (field, limit) => {
    expect(aProfile({ [field]: 'x'.repeat(limit) })[field]).toHaveLength(limit)
    expect(refusedField({ [field]: 'x'.repeat(limit + 1) })).toBe(field)
  })

  it.each(['name', 'area', 'availability'] as const)('refuses an empty or blank %s — it is required', (field) => {
    expect(refusedField({ [field]: '' })).toBe(field)
    expect(refusedField({ [field]: '   ' })).toBe(field)
  })

  it('trims what it keeps', () => {
    const profile = aProfile({ name: '  Ray  ', area: ' Lumphini area ', availability: ' Tue ', bio: ' Hi ' })
    expect([profile.name, profile.area, profile.availability, profile.bio]).toEqual(['Ray', 'Lumphini area', 'Tue', 'Hi'])
  })

  it('accepts a bio of 240 characters and refuses 241', () => {
    expect(aProfile({ bio: 'x'.repeat(240) }).bio).toHaveLength(240)
    expect(refusedField({ bio: 'x'.repeat(241) })).toBe('bio')
  })

  it('keeps a blank bio as no bio — null, not an empty string', () => {
    expect(aProfile({ bio: '   ' }).bio).toBeNull()
  })

  it('measures characters the way the contract does — code points, not UTF-16 units', () => {
    const eightyCodePoints = 'x'.repeat(79) + '🏃'
    expect(eightyCodePoints.length).toBe(81)
    expect(aProfile({ name: eightyCodePoints }).name).toBe(eightyCodePoints)
    expect(refusedField({ name: 'x'.repeat(80) + '🏃' })).toBe('name')
  })
})

describe('Profile — pace (§4)', () => {
  it('keeps each end to the nearest second', () => {
    const profile = aProfile({ paceMin: 6.3333, paceMax: 6.5 })
    expect(profile.paceMin).toBe(6.333333333333333)
  })

  it('refuses a paceMin slower than paceMax, naming paceMin', () => {
    expect(refusedField({ paceMin: 7, paceMax: 6 })).toBe('paceMin')
  })

  it('compares the ends once rounded, so two values in the same second are equal, not reversed', () => {
    const profile = aProfile({ paceMin: 6.334, paceMax: 6.333 })
    expect(profile.paceMin).toBe(6.333333333333333)
    expect(profile.paceMax).toBe(6.333333333333333)
  })

  it('accepts one steady pace as both ends', () => {
    expect(aProfile({ paceMin: 5, paceMax: 5 }).paceMax).toBe(5)
  })

  it('names the end that broke its own rule', () => {
    expect(refusedField({ paceMin: 0 })).toBe('paceMin')
    expect(refusedField({ paceMax: 20.5 })).toBe('paceMax')
  })
})

describe('Profile — experience (§4: exact case)', () => {
  it.each(['Beginner', 'Intermediate', 'Advanced'] as const)('accepts %p', (experience) => {
    expect(aProfile({ experience }).experience).toBe(experience)
  })

  it.each(['beginner', 'Expert', ''])('refuses %p', (experience) => {
    expect(refusedField({ experience: experience as never })).toBe('experience')
  })
})

describe('Profile — the point (§4: degrees, WGS 84)', () => {
  it.each([
    [-90, -180],
    [90, 180],
    [0, 0],
  ])('accepts %p, %p', (latitude, longitude) => {
    expect(aProfile({ latitude, longitude })).toMatchObject({ latitude, longitude })
  })

  it.each([
    [90.000001, 0, 'latitude'],
    [-90.000001, 0, 'latitude'],
    [Number.NaN, 0, 'latitude'],
    [0, 180.000001, 'longitude'],
    [0, -180.000001, 'longitude'],
    [0, Number.POSITIVE_INFINITY, 'longitude'],
  ])('refuses %p, %p, naming %s', (latitude, longitude, field) => {
    expect(refusedField({ latitude, longitude })).toBe(field)
  })

  it('knows its cell', () => {
    expect(aProfile({ latitude: 13.73172, longitude: 100.54153 }).areaCell()).toMatchObject({
      latitude: 13.73,
      longitude: 100.54,
    })
  })
})

describe('Profile — usual distance (§4)', () => {
  it('holds one of the three bands', () => {
    expect(aProfile({ usualDistance: '5–10 km' }).usualDistance).toBe('5–10 km')
  })

  it('refuses a hyphen for the en dash', () => {
    expect(refusedField({ usualDistance: '5-10 km' as never })).toBe('usualDistance')
  })
})

describe('Profile — gear (§4: up to 10 items, each 1–50 characters after trimming)', () => {
  it('keeps the order the runner gave', () => {
    expect(aProfile({ gear: ['Pegasus 41', 'Forerunner 265'] }).gear).toEqual(['Pegasus 41', 'Forerunner 265'])
  })

  it('trims each item, and collapses items equal once trimmed into the first', () => {
    expect(aProfile({ gear: ['  Pegasus 41  ', 'Pegasus 41', 'Forerunner 265'] }).gear).toEqual([
      'Pegasus 41',
      'Forerunner 265',
    ])
  })

  it('keeps no items as no gear — null, never []', () => {
    expect(aProfile({ gear: [] }).gear).toBeNull()
  })

  it.each(['', '   ', 'x'.repeat(51)])('refuses %p as an item', (item) => {
    expect(refusedField({ gear: [item] })).toBe('gear')
  })

  it('accepts 10 items and refuses 11', () => {
    const items = Array.from({ length: 11 }, (_, i) => `item ${i}`)
    expect(aProfile({ gear: items.slice(0, 10) }).gear).toHaveLength(10)
    expect(refusedField({ gear: items })).toBe('gear')
  })

  it('counts items after collapsing, so 11 entries naming 10 items are fine', () => {
    const items = [...Array.from({ length: 10 }, (_, i) => `item ${i}`), ' item 0 ']
    expect(aProfile({ gear: items }).gear).toHaveLength(10)
  })
})

describe('Profile — photoRef (§4: up to 128 characters)', () => {
  it('accepts 128 characters and refuses 129', () => {
    expect(aProfile({ photoRef: 'x'.repeat(128) }).photoRef).toHaveLength(128)
    expect(refusedField({ photoRef: 'x'.repeat(129) })).toBe('photoRef')
  })
})

describe('Profile — hiddenFields (§4)', () => {
  it('is a set in declared order', () => {
    expect(aProfile({ hiddenFields: ['gear', 'bio', 'gear', 'pace'] }).hiddenFields).toEqual(['bio', 'pace', 'gear'])
  })

  it.each(['name', 'area', 'photoRef', 'paceMin', 'id', 'banana'])('refuses %p — it cannot be hidden', (field) => {
    expect(refusedField({ hiddenFields: [field as HiddenField] })).toBe('hiddenFields')
  })
})

describe('Profile — an unset field is null, never absent (§3)', () => {
  it('has every key, null when unset', () => {
    const profile = aProfile()
    for (const key of ['bio', 'usualDistance', 'gear', 'photoRef'] as const) {
      expect(key in profile).toBe(true)
      expect(profile[key]).toBeNull()
    }
  })
})

describe('Profile — immutability', () => {
  it('is frozen', () => {
    const profile = aProfile()
    expect(Object.isFrozen(profile)).toBe(true)
    expect(() => {
      ;(profile as { name: string }).name = 'Beam'
    }).toThrow(TypeError)
  })

  it('freezes its lists too — and the compiler says so first', () => {
    const profile = aProfile({ gear: ['Pegasus 41'], hiddenFields: ['bio'] })
    expect(() =>
      // @ts-expect-error gear is readonly: this must not compile, and must throw if it ever does
      profile.gear?.push('Forerunner 265'),
    ).toThrow(TypeError)
    expect(() =>
      // @ts-expect-error the hidden set is readonly
      profile.hiddenFields.push('gear'),
    ).toThrow(TypeError)
  })
})

describe('Profile — revision (§4: a whole number, 1 or more; §5: it rises by one with every change)', () => {
  it('starts at 1 when the profile is created', () => {
    expect(Profile.create(RAY, content()).revision).toBe(1)
  })

  it.each([
    ['save', (p: Profile) => p.save(content({ name: 'Ray A.' }))],
    ['setFieldVisibility', (p: Profile) => p.setFieldVisibility(['bio'])],
    ['attachPhoto', (p: Profile) => p.attachPhoto(PHOTO)],
    ['removePhoto', (p: Profile) => p.removePhoto()],
  ])('rises by one with %s', (_, change) => {
    expect(change(aProfile({ revision: 4 })).revision).toBe(5)
  })

  it('rises even when the change leaves every field as it was', () => {
    const profile = aProfile({ revision: 4 })
    expect(profile.setFieldVisibility(profile.hiddenFields).revision).toBe(5)
  })

  it.each([0, -1, 1.5, Number.NaN])('refuses %s, on revision', (revision) => {
    expect(refusedField({ revision })).toBe('revision')
  })

  it('is not on the public card — it travels with the event, never on HTTP', () => {
    expect('revision' in aProfile().publicCard()).toBe(false)
  })
})
