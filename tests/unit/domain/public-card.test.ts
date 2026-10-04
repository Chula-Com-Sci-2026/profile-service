import { describe, expect, it } from 'vitest'
import { Area } from '../../../src/domain/area.ts'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import { HIDEABLE_FIELDS, type HiddenField } from '../../../src/domain/hidden-field.ts'
import { PaceRange } from '../../../src/domain/pace-range.ts'
import { PreferredRunTime } from '../../../src/domain/preferred-run-time.ts'
import { Profile, type ProfileFields } from '../../../src/domain/profile.ts'
import { UsualDistance } from '../../../src/domain/usual-distance.ts'

/** Every field but gender set; `everything()` adds gender, so a card can only be missing what was hidden. */
function everythingFields(): ProfileFields {
  return {
    userId: '7f3a9c2e15',
    displayName: 'Nok',
    bio: 'Chasing a sub-2 half.',
    avatarRef: 'avatars/7f3a9c2e15/abc',
    birthYear: 1994,
    area: new Area(13.731723456, 100.541532),
    paceRange: new PaceRange(330, 390),
    usualDistance: new UsualDistance(10_000),
    experience: 'intermediate',
    preferredRunTimes: [new PreferredRunTime('sat', 'early_morning')],
    gear: ['Pegasus 41'],
    hiddenFields: [],
  }
}

function everything(overrides: Partial<ProfileFields> = {}): Profile {
  return new Profile({ ...everythingFields(), gender: 'female', ...overrides })
}

describe('Profile — hiddenFields (§4)', () => {
  it('is empty unless the runner hides something — everything is public until hidden', () => {
    expect(everything().hiddenFields).toEqual([])
  })

  it('is a set in declared order', () => {
    const profile = everything({ hiddenFields: ['gear', 'bio', 'gear'] })
    expect(profile.hiddenFields).toEqual(['bio', 'gear'])
  })

  it.each(['displayName', 'userId', 'avatarRef', 'area', 'areaCell', 'banana'])(
    'rejects %p — it cannot be hidden',
    (field) => {
      expect(() => everything({ hiddenFields: [field as HiddenField] })).toThrow(InvalidProfileFieldError)
      expect(() => everything({ hiddenFields: [field as HiddenField] })).toThrow(
        expect.objectContaining({ field: 'hiddenFields' }),
      )
    },
  )

  it('is frozen', () => {
    const profile = everything({ hiddenFields: ['bio'] })
    expect(() =>
      // @ts-expect-error a set is readonly
      profile.hiddenFields.push('gear'),
    ).toThrow(TypeError)
  })
})

describe('Profile.publicCard — what other runners see', () => {
  it('shows every set field when nothing is hidden, the area only as its cell', () => {
    const card = everything().publicCard()
    expect(card.userId).toBe('7f3a9c2e15')
    expect(card.displayName).toBe('Nok')
    expect(card.avatarRef).toBe('avatars/7f3a9c2e15/abc')
    expect(card.areaCell.equals(new Area(13.73, 100.54).cell())).toBe(true)
    expect(card.bio).toBe('Chasing a sub-2 half.')
    expect(card.birthYear).toBe(1994)
    expect(card.gender).toBe('female')
    expect(card.paceRange?.equals(new PaceRange(330, 390))).toBe(true)
    expect(card.usualDistance?.metres).toBe(10_000)
    expect(card.experience).toBe('intermediate')
    expect(card.preferredRunTimes).toHaveLength(1)
    expect(card.gear).toEqual(['Pegasus 41'])
    expect('area' in card).toBe(false)
  })

  it.each(HIDEABLE_FIELDS.map((field) => [field]))('leaves %s off when it is hidden', (field) => {
    const card = everything({ hiddenFields: [field] }).publicCard()
    expect(field in card).toBe(false)
  })

  it('keeps the four always-shown fields when everything hideable is hidden', () => {
    const card = everything({ hiddenFields: [...HIDEABLE_FIELDS] }).publicCard()
    expect(Object.keys(card).sort()).toEqual(['areaCell', 'avatarRef', 'displayName', 'userId'])
  })

  it('leaves an unset scalar off, and shows an unset but public set as empty', () => {
    const card = new Profile({
      userId: 'b41d8e0a63',
      displayName: 'Beam',
      area: new Area(13.729, 100.559),
      preferredRunTimes: [],
      gear: [],
      hiddenFields: [],
    }).publicCard()
    expect(Object.keys(card).sort()).toEqual(['areaCell', 'displayName', 'gear', 'preferredRunTimes', 'userId'])
    expect(card.gear).toEqual([])
  })

  it('keeps a field hidden that was hidden while unset, once it is set', () => {
    const before = new Profile({ ...everythingFields(), hiddenFields: ['gender'] })
    const after = before.update({ gender: 'female' })
    expect(after.gender).toBe('female')
    expect('gender' in after.publicCard()).toBe(false)
  })

  it('is frozen', () => {
    const card = everything().publicCard()
    expect(Object.isFrozen(card)).toBe(true)
  })
})
