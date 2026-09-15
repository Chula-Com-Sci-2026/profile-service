import { describe, expect, it } from 'vitest'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import { Pace } from '../../../src/domain/pace.ts'
import { PreferredDistance } from '../../../src/domain/preferred-distance.ts'
import { Profile } from '../../../src/domain/profile.ts'

function aProfile(): Profile {
  return new Profile({
    userId: '7f3a9c2e15',
    displayName: 'Nok',
    bio: 'Chasing a sub-2 half.',
    birthYear: 1994,
    gender: 'female',
    area: 'lumphini',
    pace: new Pace(330),
    preferredDistances: [new PreferredDistance('10k')],
    preferredRunTimes: [],
  })
}

describe('Profile.update — an absent key leaves the field alone', () => {
  it('changes nothing when given nothing', () => {
    const before = aProfile()
    const after = before.update({})
    expect(after.displayName).toBe('Nok')
    expect(after.bio).toBe('Chasing a sub-2 half.')
    expect(after.pace?.secondsPerKilometre).toBe(330)
    expect(after.area).toBe('lumphini')
  })

  it('touches only what it was given', () => {
    const after = aProfile().update({ displayName: 'Nok R.' })
    expect(after.displayName).toBe('Nok R.')
    expect(after.bio).toBe('Chasing a sub-2 half.')
    expect(after.gender).toBe('female')
  })
})

describe('Profile.update — null clears', () => {
  it('removes an optional scalar entirely, rather than emptying it', () => {
    const after = aProfile().update({ bio: null })
    expect(after.bio).toBeUndefined()
    expect('bio' in after).toBe(false)
  })

  it('clears a value object', () => {
    expect(aProfile().update({ pace: null }).pace).toBeUndefined()
  })

  it('clears each optional field independently', () => {
    const after = aProfile().update({ gender: null, area: null })
    expect(after.gender).toBeUndefined()
    expect(after.area).toBeUndefined()
    expect(after.bio).toBe('Chasing a sub-2 half.')
  })
})

describe('Profile.update — sets are replaced, never cleared with null', () => {
  it('takes the new array whole', () => {
    const after = aProfile().update({
      preferredDistances: [new PreferredDistance('marathon'), new PreferredDistance('5k')],
    })
    expect(after.preferredDistances.map((d) => d.distance)).toEqual(['5k', 'marathon'])
  })

  it('empties a set with an empty array', () => {
    expect(aProfile().update({ preferredDistances: [] }).preferredDistances).toEqual([])
  })
})

describe('Profile.update — the result is a new, valid Profile', () => {
  it('leaves the original untouched', () => {
    const before = aProfile()
    const after = before.update({ displayName: 'Beam' })
    expect(before.displayName).toBe('Nok')
    expect(after).not.toBe(before)
    expect(Object.isFrozen(after)).toBe(true)
  })

  it('never changes userId', () => {
    expect(aProfile().update({ displayName: 'Beam' }).userId).toBe('7f3a9c2e15')
  })

  it('applies every §4 rule to the result', () => {
    expect(() => aProfile().update({ displayName: 'x'.repeat(51) })).toThrow(InvalidProfileFieldError)
    expect(() => aProfile().update({ birthYear: 1899 })).toThrow(InvalidProfileFieldError)
  })

  it('trims what it is given', () => {
    expect(aProfile().update({ displayName: '  Beam  ' }).displayName).toBe('Beam')
  })
})
