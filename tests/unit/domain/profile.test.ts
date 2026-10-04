import { describe, expect, it } from 'vitest'
import { Area } from '../../../src/domain/area.ts'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import { PaceRange } from '../../../src/domain/pace-range.ts'
import { PreferredRunTime } from '../../../src/domain/preferred-run-time.ts'
import { Profile, type ProfileFields } from '../../../src/domain/profile.ts'
import { UsualDistance } from '../../../src/domain/usual-distance.ts'

/** A profile carrying only what §3 requires. Overrides add the optional half. */
function aProfile(overrides: Partial<ProfileFields> = {}): Profile {
  return new Profile({
    userId: '7f3a9c2e15',
    displayName: 'Nok',
    area: new Area(13.7314, 100.5414),
    preferredRunTimes: [],
    gear: [],
    ...overrides,
  })
}

const thisYear = new Date().getFullYear()

describe('Profile — required fields', () => {
  it('needs only displayName and area beyond the identity', () => {
    const profile = aProfile()
    expect(profile.userId).toBe('7f3a9c2e15')
    expect(profile.area.equals(new Area(13.7314, 100.5414))).toBe(true)
    expect(profile.bio).toBeUndefined()
    expect('birthYear' in profile).toBe(false)
    expect(profile.gear).toEqual([])
  })

  it.each(['', '   '])('rejects %p as a userId', (userId) => {
    expect(() => aProfile({ userId })).toThrow(InvalidProfileFieldError)
  })

  it('rejects a userId over 64 characters', () => {
    expect(() => aProfile({ userId: 'x'.repeat(65) })).toThrow(InvalidProfileFieldError)
    expect(aProfile({ userId: 'x'.repeat(64) }).userId).toHaveLength(64)
  })

  it.each(['', '   '])('rejects %p as a displayName', (displayName) => {
    expect(() => aProfile({ displayName })).toThrow(InvalidProfileFieldError)
  })

  it('rejects a displayName over 50 characters', () => {
    expect(() => aProfile({ displayName: 'x'.repeat(51) })).toThrow(InvalidProfileFieldError)
    expect(aProfile({ displayName: 'x'.repeat(50) }).displayName).toHaveLength(50)
  })

  it('measures characters the way the contract does — code points, not UTF-16 units', () => {
    const fiftyCodePoints = 'x'.repeat(49) + '🏃'
    expect(fiftyCodePoints.length).toBe(51)
    expect(aProfile({ displayName: fiftyCodePoints }).displayName).toBe(fiftyCodePoints)
    expect(() => aProfile({ displayName: 'x'.repeat(50) + '🏃' })).toThrow(InvalidProfileFieldError)
  })

  it('trims text before measuring it', () => {
    expect(aProfile({ displayName: '  Nok  ' }).displayName).toBe('Nok')
    expect(aProfile({ userId: ' 7f3a9c2e15 ' }).userId).toBe('7f3a9c2e15')
  })
})

describe('Profile — optional fields', () => {
  it('rejects a bio over 500 characters', () => {
    expect(() => aProfile({ bio: 'x'.repeat(501) })).toThrow(InvalidProfileFieldError)
    expect(aProfile({ bio: 'x'.repeat(500) }).bio).toHaveLength(500)
  })

  it('rejects an avatarRef over 128 characters', () => {
    expect(() => aProfile({ avatarRef: 'x'.repeat(129) })).toThrow(InvalidProfileFieldError)
    expect(aProfile({ avatarRef: 'x'.repeat(128) }).avatarRef).toHaveLength(128)
  })

  it('treats whitespace-only optional text as never given, so absent is the only unset state', () => {
    expect(aProfile({ bio: '   ' }).bio).toBeUndefined()
    expect('bio' in aProfile({ bio: '   ' })).toBe(false)
  })

  it.each(['banana', '', 'MALE'])('rejects %p as a gender', (gender) => {
    expect(() => aProfile({ gender: gender as never })).toThrow(InvalidProfileFieldError)
  })

  it('holds the area as a value object that knows its cell', () => {
    const profile = aProfile({ area: new Area(13.803, 100.553) })
    expect(profile.area).toBeInstanceOf(Area)
    expect(profile.area.cell()).toMatchObject({ latitude: 13.8, longitude: 100.55 })
  })

  it.each(['expert', ''])('rejects %p as an experience', (experience) => {
    expect(() => aProfile({ experience: experience as never })).toThrow(InvalidProfileFieldError)
  })

  it('holds value objects rather than bare numbers', () => {
    const profile = aProfile({ paceRange: new PaceRange(300, 360), usualDistance: new UsualDistance(8_000) })
    expect(profile.paceRange?.fastest.secondsPerKilometre).toBe(300)
    expect(profile.paceRange?.slowest.secondsPerKilometre).toBe(360)
    expect(profile.usualDistance?.metres).toBe(8_000)
  })
})

describe('Profile — birthYear (§4: integer, 1900 to the current year)', () => {
  it.each([1900, 1994, thisYear])('accepts %i', (birthYear) => {
    expect(aProfile({ birthYear }).birthYear).toBe(birthYear)
  })

  it.each([1899, thisYear + 1])('rejects %i', (birthYear) => {
    expect(() => aProfile({ birthYear })).toThrow(InvalidProfileFieldError)
  })

  it('rejects a fractional year', () => {
    expect(() => aProfile({ birthYear: 1994.5 })).toThrow(InvalidProfileFieldError)
  })

  it('is optional — left out, it is absent', () => {
    expect('birthYear' in aProfile()).toBe(false)
  })
})

describe('Profile — sets', () => {
  it('drops duplicates, because a set is not a list', () => {
    const profile = aProfile({
      preferredRunTimes: [new PreferredRunTime('mon', 'evening'), new PreferredRunTime('mon', 'evening')],
    })
    expect(profile.preferredRunTimes).toHaveLength(1)
  })

  it('sorts run times by day, then time of day', () => {
    const profile = aProfile({
      preferredRunTimes: [
        new PreferredRunTime('wed', 'evening'),
        new PreferredRunTime('mon', 'evening'),
        new PreferredRunTime('mon', 'early_morning'),
      ],
    })
    expect(profile.preferredRunTimes.map((t) => `${t.dayOfWeek}/${t.timeOfDay}`)).toEqual([
      'mon/early_morning',
      'mon/evening',
      'wed/evening',
    ])
  })

  it('is empty rather than absent when unset', () => {
    expect(aProfile().preferredRunTimes).toEqual([])
  })
})

describe('Profile — gear (§4: up to 10 items, each 1–50 characters after trimming)', () => {
  it('keeps the order the runner gave', () => {
    expect(aProfile({ gear: ['Pegasus 41', 'Forerunner 265'] }).gear).toEqual(['Pegasus 41', 'Forerunner 265'])
  })

  it('trims each item', () => {
    expect(aProfile({ gear: ['  Pegasus 41  '] }).gear).toEqual(['Pegasus 41'])
  })

  it('collapses items that are equal once trimmed into the first', () => {
    expect(aProfile({ gear: ['Pegasus 41', ' Pegasus 41 ', 'Forerunner 265'] }).gear).toEqual([
      'Pegasus 41',
      'Forerunner 265',
    ])
  })

  it.each(['', '   '])('rejects %p as an item', (item) => {
    expect(() => aProfile({ gear: [item] })).toThrow(InvalidProfileFieldError)
  })

  it('rejects an item over 50 characters, counting code points', () => {
    expect(() => aProfile({ gear: ['x'.repeat(51)] })).toThrow(InvalidProfileFieldError)
    expect(aProfile({ gear: ['x'.repeat(49) + '🏃'] }).gear[0]).toHaveLength(51)
  })

  it('accepts 10 items and rejects 11', () => {
    const items = Array.from({ length: 11 }, (_, i) => `item ${i}`)
    expect(aProfile({ gear: items.slice(0, 10) }).gear).toHaveLength(10)
    expect(() => aProfile({ gear: items })).toThrow(expect.objectContaining({ field: 'gear' }))
  })

  it('counts items after collapsing, so 11 entries naming 10 items are fine', () => {
    const items = [...Array.from({ length: 10 }, (_, i) => `item ${i}`), ' item 0 ']
    expect(aProfile({ gear: items }).gear).toHaveLength(10)
  })
})

describe('Profile — immutability', () => {
  it('is frozen', () => {
    const profile = aProfile()
    expect(Object.isFrozen(profile)).toBe(true)
    expect(() => {
      ;(profile as { displayName: string }).displayName = 'Beam'
    }).toThrow(TypeError)
  })

  it('freezes its sets too — and the compiler says so first', () => {
    const profile = aProfile({ gear: ['Pegasus 41'] })
    expect(() =>
      // @ts-expect-error a set is readonly: this must not compile, and must throw if it ever does
      profile.gear.push('Forerunner 265'),
    ).toThrow(TypeError)
  })
})
