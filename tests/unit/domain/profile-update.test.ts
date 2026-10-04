import { describe, expect, it } from 'vitest'
import { Area } from '../../../src/domain/area.ts'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import { PaceRange } from '../../../src/domain/pace-range.ts'
import { Profile } from '../../../src/domain/profile.ts'
import { UsualDistance } from '../../../src/domain/usual-distance.ts'

function aProfile(): Profile {
  return new Profile({
    userId: '7f3a9c2e15',
    displayName: 'Nok',
    bio: 'Chasing a sub-2 half.',
    birthYear: 1994,
    gender: 'female',
    area: new Area(13.7314, 100.5414),
    paceRange: new PaceRange(330, 390),
    usualDistance: new UsualDistance(10_000),
    preferredRunTimes: [],
    gear: ['Pegasus 41'],
    hiddenFields: [],
  })
}

describe('Profile.update — an absent key leaves the field alone', () => {
  it('changes nothing when given nothing', () => {
    const before = aProfile()
    const after = before.update({})
    expect(after.displayName).toBe('Nok')
    expect(after.bio).toBe('Chasing a sub-2 half.')
    expect(after.paceRange?.equals(new PaceRange(330, 390))).toBe(true)
    expect(after.area.equals(new Area(13.7314, 100.5414))).toBe(true)
    expect(after.gear).toEqual(['Pegasus 41'])
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
    expect(aProfile().update({ paceRange: null }).paceRange).toBeUndefined()
    expect(aProfile().update({ usualDistance: null }).usualDistance).toBeUndefined()
  })

  it('clears the birth year — it is no longer required', () => {
    const after = aProfile().update({ birthYear: null })
    expect(after.birthYear).toBeUndefined()
    expect('birthYear' in after).toBe(false)
  })

  it('clears each optional field independently', () => {
    const after = aProfile().update({ gender: null, paceRange: null })
    expect(after.gender).toBeUndefined()
    expect(after.paceRange).toBeUndefined()
    expect(after.bio).toBe('Chasing a sub-2 half.')
  })
})

describe('Profile.update — an area and a pace range are replaced whole', () => {
  it('takes a new area whole', () => {
    const after = aProfile().update({ area: new Area(13.803, 100.553) })
    expect(after.area.equals(new Area(13.803, 100.553))).toBe(true)
  })

  it('keeps the area when the change leaves it out', () => {
    const after = aProfile().update({ displayName: 'Nok R.' })
    expect(after.area.equals(new Area(13.7314, 100.5414))).toBe(true)
  })

  it('takes a new pace range whole', () => {
    expect(aProfile().update({ paceRange: new PaceRange(300, 300) }).paceRange?.equals(new PaceRange(300, 300))).toBe(true)
  })
})

describe('Profile.update — sets are replaced, never cleared with null', () => {
  it('takes the new array whole', () => {
    const after = aProfile().update({ gear: ['Forerunner 265', 'Pegasus 41'] })
    expect(after.gear).toEqual(['Forerunner 265', 'Pegasus 41'])
  })

  it('empties a set with an empty array', () => {
    expect(aProfile().update({ gear: [] }).gear).toEqual([])
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
    expect(() => aProfile().update({ gear: [''] })).toThrow(InvalidProfileFieldError)
  })

  it('trims what it is given', () => {
    expect(aProfile().update({ displayName: '  Beam  ' }).displayName).toBe('Beam')
  })
})

describe('Profile.update — hidden fields are a set like any other', () => {
  it('replaces the hidden set whole', () => {
    const after = aProfile().update({ hiddenFields: ['gender', 'birthYear'] })
    expect(after.hiddenFields).toEqual(['birthYear', 'gender'])
    expect(after.update({ hiddenFields: [] }).hiddenFields).toEqual([])
  })

  it('keeps the hidden set when the change leaves it out', () => {
    const hidden = aProfile().update({ hiddenFields: ['gender'] })
    expect(hidden.update({ displayName: 'Nok R.' }).hiddenFields).toEqual(['gender'])
  })
})
