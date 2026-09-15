import { describe, expect, it } from 'vitest'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import { Pace } from '../../../src/domain/pace.ts'
import { PreferredDistance } from '../../../src/domain/preferred-distance.ts'
import { PreferredRunTime } from '../../../src/domain/preferred-run-time.ts'
import { Profile, type ProfileFields } from '../../../src/domain/profile.ts'
import { Volume } from '../../../src/domain/volume.ts'

/** A profile carrying only what §3 requires. Overrides add the optional half. */
function aProfile(overrides: Partial<ProfileFields> = {}): Profile {
  return new Profile({
    userId: '7f3a9c2e15',
    displayName: 'Nok',
    birthYear: 1994,
    preferredDistances: [],
    preferredRunTimes: [],
    ...overrides,
  })
}

const thisYear = new Date().getFullYear()

describe('Profile — required fields', () => {
  it('needs only displayName and birthYear beyond the identity', () => {
    const profile = aProfile()
    expect(profile.userId).toBe('7f3a9c2e15')
    expect(profile.bio).toBeUndefined()
    expect(profile.preferredDistances).toEqual([])
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

  it.each(['sukhumvit', ''])('rejects %p as an area', (area) => {
    expect(() => aProfile({ area: area as never })).toThrow(InvalidProfileFieldError)
  })

  it.each(['expert', ''])('rejects %p as an experience', (experience) => {
    expect(() => aProfile({ experience: experience as never })).toThrow(InvalidProfileFieldError)
  })

  it('holds value objects rather than bare numbers', () => {
    const profile = aProfile({ pace: new Pace(300), volume: new Volume(45_000) })
    expect(profile.pace?.secondsPerKilometre).toBe(300)
    expect(profile.volume?.metresPerWeek).toBe(45_000)
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
})

describe('Profile — sets', () => {
  it('drops duplicates, because a set is not a list', () => {
    const profile = aProfile({
      preferredDistances: [new PreferredDistance('10k'), new PreferredDistance('10k')],
    })
    expect(profile.preferredDistances).toHaveLength(1)
  })

  it('sorts into declared order, not alphabetical', () => {
    const profile = aProfile({
      preferredDistances: [
        new PreferredDistance('marathon'),
        new PreferredDistance('10k'),
        new PreferredDistance('5k'),
      ],
    })
    expect(profile.preferredDistances.map((d) => d.distance)).toEqual(['5k', '10k', 'marathon'])
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

describe('Profile — immutability', () => {
  it('is frozen', () => {
    const profile = aProfile()
    expect(Object.isFrozen(profile)).toBe(true)
    expect(() => {
      ;(profile as { displayName: string }).displayName = 'Beam'
    }).toThrow(TypeError)
  })

  it('freezes its sets too — and the compiler says so first', () => {
    const profile = aProfile({ preferredDistances: [new PreferredDistance('5k')] })
    expect(() =>
      // @ts-expect-error a set is readonly: this must not compile, and must throw if it ever does
      profile.preferredDistances.push(new PreferredDistance('10k')),
    ).toThrow(TypeError)
  })
})
