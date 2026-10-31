import { describe, expect, it } from 'vitest'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import { Profile, type ProfileContent } from '../../../src/domain/profile.ts'

const RAY = '11111111-1111-4111-8111-111111111111'
const PHOTO = `photos/${RAY}/0b5f3c1e-7d2a-4e9b-8f61-2c4d6e8a0b1c`

/** What a save carries: his contract's fields, nothing of ours. */
function content(overrides: Partial<ProfileContent> = {}): ProfileContent {
  return {
    name: 'Ray Attajak',
    paceMin: 6,
    paceMax: 6.5,
    experience: 'Intermediate',
    area: 'Lumphini area',
    latitude: 13.7308,
    longitude: 100.5418,
    availability: 'Tue & Thu evenings',
    ...overrides,
  }
}

/** A saved profile with every optional field set, something hidden and a photo. */
function aSavedProfile(): Profile {
  return new Profile({
    id: RAY,
    name: 'Ray',
    bio: 'Evening runs only.',
    paceMin: 5,
    paceMax: 5.5,
    experience: 'Advanced',
    area: 'Benjakitti Park',
    latitude: 13.729,
    longitude: 100.559,
    availability: 'Weekends',
    usualDistance: 'Over 10 km',
    gear: ['Pegasus 41'],
    photoRef: PHOTO,
    hiddenFields: ['bio', 'gear'],
    revision: 1,
  })
}

describe('Profile.create — the first save', () => {
  it('holds what was sent, under the runner’s id', () => {
    const profile = Profile.create(RAY, content())
    expect(profile).toMatchObject({ id: RAY, name: 'Ray Attajak', paceMin: 6, area: 'Lumphini area', availability: 'Tue & Thu evenings' })
  })

  it('hides nothing and has no photo', () => {
    const profile = Profile.create(RAY, content())
    expect(profile.hiddenFields).toEqual([])
    expect(profile.photoRef).toBeNull()
  })

  it('leaves what was left out unset — null', () => {
    const profile = Profile.create(RAY, content())
    expect([profile.bio, profile.usualDistance, profile.gear]).toEqual([null, null, null])
  })

  it('takes our additions when they are sent', () => {
    const profile = Profile.create(RAY, content({ usualDistance: '5–10 km', gear: ['Pegasus 41'] }))
    expect(profile.usualDistance).toBe('5–10 km')
    expect(profile.gear).toEqual(['Pegasus 41'])
  })
})

describe('Profile.save — his fields are a true replace', () => {
  it('replaces name, the pace, experience, area, the point and availability', () => {
    const saved = aSavedProfile().save(content())
    expect(saved).toMatchObject({
      name: 'Ray Attajak',
      paceMin: 6,
      paceMax: 6.5,
      experience: 'Intermediate',
      area: 'Lumphini area',
      latitude: 13.7308,
      longitude: 100.5418,
      availability: 'Tue & Thu evenings',
    })
  })

  it('treats a bio left out as no bio', () => {
    expect(aSavedProfile().save(content()).bio).toBeNull()
  })

  it('treats a null bio as no bio', () => {
    expect(aSavedProfile().save(content({ bio: null })).bio).toBeNull()
  })

  it('takes a bio that is sent', () => {
    expect(aSavedProfile().save(content({ bio: 'New bio' })).bio).toBe('New bio')
  })
})

describe('Profile.save — our additions keep when left out', () => {
  it('keeps usualDistance and gear when they are left out', () => {
    const saved = aSavedProfile().save(content())
    expect(saved.usualDistance).toBe('Over 10 km')
    expect(saved.gear).toEqual(['Pegasus 41'])
  })

  it('clears usualDistance with null', () => {
    expect(aSavedProfile().save(content({ usualDistance: null })).usualDistance).toBeNull()
  })

  it.each([[null], [[]]])('clears gear with %j', (gear) => {
    expect(aSavedProfile().save(content({ gear })).gear).toBeNull()
  })

  it('replaces them when they are sent', () => {
    const saved = aSavedProfile().save(content({ usualDistance: 'Under 5 km', gear: ['Vaporfly 3'] }))
    expect(saved.usualDistance).toBe('Under 5 km')
    expect(saved.gear).toEqual(['Vaporfly 3'])
  })
})

describe('Profile.save — what a save never touches', () => {
  it('keeps the hidden set, so a save can never reveal anything', () => {
    expect(aSavedProfile().save(content()).hiddenFields).toEqual(['bio', 'gear'])
  })

  it('keeps the photo, so a save can never detach it', () => {
    expect(aSavedProfile().save(content()).photoRef).toBe(PHOTO)
  })

  it('keeps the id', () => {
    expect(aSavedProfile().save(content()).id).toBe(RAY)
  })
})

describe('Profile.save — the result is a new, valid Profile', () => {
  it('leaves the original untouched', () => {
    const before = aSavedProfile()
    const after = before.save(content())
    expect(before.name).toBe('Ray')
    expect(after).not.toBe(before)
    expect(Object.isFrozen(after)).toBe(true)
  })

  it('applies every §4 rule to the result', () => {
    expect(() => aSavedProfile().save(content({ name: 'x'.repeat(81) }))).toThrow(InvalidProfileFieldError)
    expect(() => aSavedProfile().save(content({ paceMin: 7, paceMax: 6 }))).toThrow(InvalidProfileFieldError)
    expect(() => aSavedProfile().save(content({ gear: [''] }))).toThrow(InvalidProfileFieldError)
  })
})

describe('Profile.attachPhoto and removePhoto — domain.md §3', () => {
  const OTHER = `photos/${RAY}/9d3a7c5e-1b2f-4a6c-8e0d-3f5b7a9c1e2d`

  it('attachPhoto puts the key on the profile and changes nothing else but the revision', () => {
    const before = aSavedProfile()
    const after = before.attachPhoto(OTHER)
    expect(after.photoRef).toBe(OTHER)
    expect({ ...after, photoRef: null, revision: 0 }).toEqual({ ...before, photoRef: null, revision: 0 })
    expect(Object.isFrozen(after)).toBe(true)
  })

  it('attachPhoto holds the key to §4: 128 characters at most', () => {
    expect(() => aSavedProfile().attachPhoto('x'.repeat(129))).toThrow(
      expect.objectContaining({ field: 'photoRef' }),
    )
  })

  it('removePhoto takes the photo off, and changes nothing else', () => {
    const after = aSavedProfile().removePhoto()
    expect(after.photoRef).toBeNull()
    expect(after.hiddenFields).toEqual(['bio', 'gear'])
  })

  it('a save after attaching keeps the photo', () => {
    expect(Profile.create(RAY, content()).attachPhoto(OTHER).save(content()).photoRef).toBe(OTHER)
  })
})

