import { describe, expect, it } from 'vitest'
import { createProfile } from '../../../src/application/create-profile.ts'
import { InvalidProfileFieldError, ProfileAlreadyExistsError } from '../../../src/domain/errors.ts'
import type { ProfileRepository } from '../../../src/domain/profile-repository.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { fieldsFor } from './profiles.ts'
import { RecordingProfileEvents, publishing } from './profile-events-double.ts'

describe('createProfile', () => {
  it('stores the profile and hands it back', async () => {
    const repository = new InMemoryProfileRepository()
    const profile = await createProfile(repository, publishing())(fieldsFor())

    expect(profile.userId).toBe('7f3a9c2e15')
    // toEqual, not toBe: the Drizzle repository rebuilds the Profile through toDomain, so
    // reference identity is something only the in-memory fake would give us.
    expect(await repository.findById('7f3a9c2e15')).toEqual(profile)
  })

  it('raises the domain error when a runner already has one', async () => {
    const repository = new InMemoryProfileRepository()
    await createProfile(repository, publishing())(fieldsFor())

    await expect(createProfile(repository, publishing())(fieldsFor())).rejects.toThrow(ProfileAlreadyExistsError)
    expect(repository.size).toBe(1)
  })

  it('lets the write decide, rather than looking first', async () => {
    // A check-then-insert leaves a window between the two. Only insert is consulted, so
    // §5's one-profile-per-runner rests on the primary key.
    let lookups = 0
    const repository: ProfileRepository = {
      findById: async () => {
        lookups += 1
        return null
      },
      insert: async () => {},
      update: async () => true,
    }

    await createProfile(repository, publishing())(fieldsFor())
    expect(lookups).toBe(0)
  })

  it('refuses fields that break a §4 rule, before anything is stored', async () => {
    const repository = new InMemoryProfileRepository()

    await expect(createProfile(repository, publishing())(fieldsFor({ displayName: '  ' }))).rejects.toThrow(
      InvalidProfileFieldError,
    )
    expect(repository.size).toBe(0)
  })
})

describe('createProfile — telling subscribers', () => {
  it('publishes the saved profile, after the write', async () => {
    const repository = new InMemoryProfileRepository()
    const events = new RecordingProfileEvents()
    let storedWhenPublished = false
    events.updated = async (profile) => {
      storedWhenPublished = (await repository.findById(profile.userId)) !== null
      events.published.push({ type: 'updated', profile })
    }

    const profile = await createProfile(repository, publishing(events))(fieldsFor())

    expect(events.published).toEqual([{ type: 'updated', profile }])
    expect(storedWhenPublished).toBe(true)
  })

  it('publishes nothing when the write is refused', async () => {
    const repository = new InMemoryProfileRepository()
    await createProfile(repository, publishing())(fieldsFor())
    const events = new RecordingProfileEvents()

    await expect(createProfile(repository, publishing(events))(fieldsFor())).rejects.toThrow(
      ProfileAlreadyExistsError,
    )
    expect(events.published).toEqual([])
  })

  it('still hands back the profile when delivery fails, and reports it (ADR-0019)', async () => {
    const events = new RecordingProfileEvents()
    events.failWith = new Error('Buddy Discovery is down')
    const undelivered: string[] = []

    const profile = await createProfile(new InMemoryProfileRepository(), {
      events,
      onUndelivered: (userId) => undelivered.push(userId),
    })(fieldsFor())

    expect(profile.userId).toBe('7f3a9c2e15')
    expect(undelivered).toEqual(['7f3a9c2e15'])
  })
})
