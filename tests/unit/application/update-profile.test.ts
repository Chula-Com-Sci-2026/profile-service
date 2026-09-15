import { describe, expect, it } from 'vitest'
import { updateProfile } from '../../../src/application/update-profile.ts'
import { InvalidProfileFieldError, ProfileNotFoundError } from '../../../src/domain/errors.ts'
import type { Profile } from '../../../src/domain/profile.ts'
import type { ProfileRepository } from '../../../src/domain/profile-repository.ts'
import { FakeAvatarStorage } from './avatar-storage-double.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { aProfile } from './profiles.ts'

describe('updateProfile', () => {
  it('applies the changes and stores the result', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())

    const updated = await updateProfile(repository, new FakeAvatarStorage(), () => {})('7f3a9c2e15', { displayName: 'Nok R.' })

    expect(updated.displayName).toBe('Nok R.')
    expect((await repository.findById('7f3a9c2e15'))?.displayName).toBe('Nok R.')
  })

  it('leaves an absent field alone and clears an explicit null', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())

    const updated = await updateProfile(repository, new FakeAvatarStorage(), () => {})('7f3a9c2e15', { bio: null })

    expect(updated.bio).toBeUndefined()
    expect(updated.gender).toBe('female')
    expect(updated.pace?.secondsPerKilometre).toBe(330)
  })

  it('never changes userId', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())

    expect((await updateProfile(repository, new FakeAvatarStorage(), () => {})('7f3a9c2e15', { displayName: 'Beam' })).userId).toBe('7f3a9c2e15')
  })

  it('raises the domain error when there is no such profile', async () => {
    const repository = new InMemoryProfileRepository()

    await expect(updateProfile(repository, new FakeAvatarStorage(), () => {})('nobody', { displayName: 'Beam' })).rejects.toThrow(
      ProfileNotFoundError,
    )
  })

  it('raises it again when the profile is deleted between the read and the write', async () => {
    const stored = aProfile()
    const repository: ProfileRepository = {
      findById: async () => stored,
      insert: async () => {},
      update: async () => false, // gone by the time we wrote
      delete: async () => true,
    }

    await expect(updateProfile(repository, new FakeAvatarStorage(), () => {})('7f3a9c2e15', { displayName: 'Beam' })).rejects.toThrow(
      ProfileNotFoundError,
    )
  })

  it('refuses a change that breaks a §4 rule, leaving the stored profile alone', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())

    await expect(
      updateProfile(repository, new FakeAvatarStorage(), () => {})('7f3a9c2e15', { displayName: 'x'.repeat(51) }),
    ).rejects.toThrow(InvalidProfileFieldError)
    expect((await repository.findById('7f3a9c2e15'))?.displayName).toBe('Nok')
  })
})

describe('updateProfile — the avatar it displaces', () => {
  const withAvatar = (): Profile => aProfile({ avatarRef: 'avatars/7f3a9c2e15/old' })

  it('drops the old object when a new avatar replaces it', async () => {
    const repository = new InMemoryProfileRepository()
    const storage = new FakeAvatarStorage()
    repository.given(withAvatar())

    await updateProfile(repository, storage, () => {})('7f3a9c2e15', {
      avatarRef: 'avatars/7f3a9c2e15/new',
    })

    expect(storage.removedKeys).toEqual(['avatars/7f3a9c2e15/old'])
  })

  it('drops it when the avatar is cleared', async () => {
    const repository = new InMemoryProfileRepository()
    const storage = new FakeAvatarStorage()
    repository.given(withAvatar())

    await updateProfile(repository, storage, () => {})('7f3a9c2e15', { avatarRef: null })

    expect(storage.removedKeys).toEqual(['avatars/7f3a9c2e15/old'])
  })

  it('leaves it alone when the change is about something else', async () => {
    const repository = new InMemoryProfileRepository()
    const storage = new FakeAvatarStorage()
    repository.given(withAvatar())

    await updateProfile(repository, storage, () => {})('7f3a9c2e15', { displayName: 'Nok R.' })

    expect(storage.removedKeys).toEqual([])
  })

  it('keeps the change when storage fails, and reports the orphan', async () => {
    const repository = new InMemoryProfileRepository()
    const storage = new FakeAvatarStorage()
    storage.failOnRemove = true
    repository.given(withAvatar())
    const orphans: string[] = []

    const updated = await updateProfile(repository, storage, (userId) => orphans.push(userId))(
      '7f3a9c2e15',
      { avatarRef: 'avatars/7f3a9c2e15/new' },
    )

    expect(updated.avatarRef).toBe('avatars/7f3a9c2e15/new')
    expect(orphans).toEqual(['7f3a9c2e15'])
  })
})

describe('updateProfile — an avatar that is not yours', () => {
  it('refuses to delete a key belonging to another runner', async () => {
    // Every profile is readable and avatarRef is client-supplied, so a runner can name someone
    // else's key on their own profile and then clear it. Verified as a live attack before this
    // existed: three authorised requests, and the victim's image was gone.
    const repository = new InMemoryProfileRepository()
    const storage = new FakeAvatarStorage()
    repository.given(aProfile({ avatarRef: 'avatars/somebody-else/their-image' }))
    const orphans: string[] = []

    await updateProfile(repository, storage, (userId) => orphans.push(userId))('7f3a9c2e15', {
      avatarRef: null,
    })

    expect(storage.removedKeys).toEqual([])
    expect(orphans).toEqual(['7f3a9c2e15'])
  })
})
