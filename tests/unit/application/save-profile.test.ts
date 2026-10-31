import { describe, expect, it } from 'vitest'
import { saveProfile } from '../../../src/application/save-profile.ts'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import { Profile } from '../../../src/domain/profile.ts'
import type { ProfileRepository } from '../../../src/domain/profile-repository.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { RecordingProfileEvents, publishing } from './profile-events-double.ts'
import { aProfile, contentFor, RAY } from './profiles.ts'

const PHOTO = `photos/${RAY}/0b5f3c1e-7d2a-4e9b-8f61-2c4d6e8a0b1c`

describe('saveProfile — creating or replacing', () => {
  it('creates the profile on the first save, and hands it back', async () => {
    const repository = new InMemoryProfileRepository()

    const saved = await saveProfile(repository, publishing())(RAY, contentFor())

    expect(saved.id).toBe(RAY)
    expect(saved.hiddenFields).toEqual([])
    // toEqual, not toBe: the Drizzle repository rebuilds the Profile through toDomain.
    expect(await repository.findById(RAY)).toEqual(saved)
  })

  it('replaces it on a later save, keeping what a save never touches', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile({ hiddenFields: ['bio'], photoRef: PHOTO }))

    const saved = await saveProfile(repository, publishing())(RAY, contentFor({ name: 'Ray A.', bio: null }))

    expect(saved.name).toBe('Ray A.')
    expect(saved.bio).toBeNull()
    expect(saved.hiddenFields).toEqual(['bio'])
    expect(saved.photoRef).toBe(PHOTO)
    expect((await repository.findById(RAY))?.name).toBe('Ray A.')
    expect(repository.size).toBe(1)
  })

  it('refuses content that breaks a §4 rule, storing nothing', async () => {
    const repository = new InMemoryProfileRepository()

    await expect(saveProfile(repository, publishing())(RAY, contentFor({ name: '  ' }))).rejects.toThrow(
      InvalidProfileFieldError,
    )
    expect(repository.size).toBe(0)
  })

  it('answers a double-submitted first save by replacing what the other one created', async () => {
    // Two first saves at once: both read "no profile", the other one inserts first, and this
    // one's insert then meets the primary key. It must answer as a second save would.
    const repository = new InMemoryProfileRepository()
    let raced = false
    const racing: ProfileRepository = {
      findById: async (id) => {
        if (!raced) {
          raced = true
          repository.given(Profile.create(id, contentFor({ name: 'Other tab' })))
          return null
        }
        return repository.findById(id)
      },
      findAll: () => repository.findAll(),
      insert: (profile) => repository.insert(profile),
      update: (profile) => repository.update(profile),
    }

    const saved = await saveProfile(racing, publishing())(RAY, contentFor({ name: 'Ray' }))

    expect(saved.name).toBe('Ray')
    expect((await repository.findById(RAY))?.name).toBe('Ray')
  })
})

describe('saveProfile — telling subscribers', () => {
  it('publishes the saved profile, after the write', async () => {
    const repository = new InMemoryProfileRepository()
    const events = new RecordingProfileEvents()
    let storedWhenPublished = false
    events.updated = async (profile) => {
      storedWhenPublished = (await repository.findById(profile.id)) !== null
      events.published.push({ type: 'updated', profile })
    }

    const saved = await saveProfile(repository, publishing(events))(RAY, contentFor())

    expect(events.published).toEqual([{ type: 'updated', profile: saved }])
    expect(storedWhenPublished).toBe(true)
  })

  it('publishes nothing when the save is refused', async () => {
    const events = new RecordingProfileEvents()

    await expect(
      saveProfile(new InMemoryProfileRepository(), publishing(events))(RAY, contentFor({ paceMin: 0 })),
    ).rejects.toThrow(InvalidProfileFieldError)
    expect(events.published).toEqual([])
  })

  it('still saves when delivery fails, and reports it (ADR-0019)', async () => {
    const repository = new InMemoryProfileRepository()
    const events = new RecordingProfileEvents()
    events.failWith = new Error('Buddy Discovery is down')
    const undelivered: string[] = []

    const saved = await saveProfile(repository, { events, onUndelivered: (id) => undelivered.push(id) })(RAY, contentFor())

    expect(saved.id).toBe(RAY)
    expect(await repository.findById(RAY)).not.toBeNull()
    expect(undelivered).toEqual([RAY])
  })
})
