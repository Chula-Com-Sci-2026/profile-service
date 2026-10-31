import { Profile, type ProfileContent, type ProfileFields } from '../../../src/domain/profile.ts'

/** Identity's Ray (its `seed-demo.js`). */
export const RAY = '11111111-1111-4111-8111-111111111111'

/**
 * What a save carries, with overrides for whatever a test cares about.
 * Plain data — it never constructs a Profile, so a test can hand it something §4 forbids.
 */
export function contentFor(overrides: Partial<ProfileContent> = {}): ProfileContent {
  return {
    name: 'Ray Attajak',
    bio: 'Evening runs, Lumphini.',
    paceMin: 6,
    paceMax: 6.5,
    experience: 'Intermediate',
    area: 'Lumphini area',
    latitude: 13.7308,
    longitude: 100.5418,
    availability: 'Tue & Thu evenings',
    gear: ['Pegasus 41'],
    ...overrides,
  }
}

/** A stored profile — Ray, as `contentFor()` would create him — with any field overridden. */
export function aProfile(overrides: Partial<ProfileFields> = {}): Profile {
  const created = Profile.create(RAY, contentFor())
  return new Profile({
    id: created.id,
    name: created.name,
    bio: created.bio,
    paceMin: created.paceMin,
    paceMax: created.paceMax,
    experience: created.experience,
    area: created.area,
    latitude: created.latitude,
    longitude: created.longitude,
    availability: created.availability,
    usualDistance: created.usualDistance,
    gear: created.gear,
    photoRef: created.photoRef,
    hiddenFields: created.hiddenFields,
    revision: created.revision,
    ...overrides,
  })
}
