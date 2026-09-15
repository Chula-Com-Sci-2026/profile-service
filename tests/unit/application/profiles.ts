import { Pace } from '../../../src/domain/pace.ts'
import { PreferredDistance } from '../../../src/domain/preferred-distance.ts'
import { Profile, type ProfileFields } from '../../../src/domain/profile.ts'

/**
 * Fields for a valid profile, with overrides for whatever a test cares about.
 * Plain data — it never constructs a Profile, so a test can hand it something §4 forbids.
 */
export function fieldsFor(overrides: Partial<ProfileFields> = {}): ProfileFields {
  return {
    userId: '7f3a9c2e15',
    displayName: 'Nok',
    bio: 'Chasing a sub-2 half.',
    birthYear: 1994,
    gender: 'female',
    pace: new Pace(330),
    preferredDistances: [new PreferredDistance('10k')],
    preferredRunTimes: [],
    ...overrides,
  }
}

export function aProfile(overrides: Partial<ProfileFields> = {}): Profile {
  return new Profile(fieldsFor(overrides))
}
