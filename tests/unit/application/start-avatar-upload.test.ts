import { describe, expect, it } from 'vitest'
import { startAvatarUpload } from '../../../src/application/start-avatar-upload.ts'
import { ProfileNotFoundError } from '../../../src/domain/errors.ts'
import { FakeAvatarStorage } from './avatar-storage-double.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { aProfile } from './profiles.ts'

describe('startAvatarUpload', () => {
  it('returns a URL to upload to and the key it will occupy', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())

    const upload = await startAvatarUpload(repository, new FakeAvatarStorage())('7f3a9c2e15')

    expect(upload.uploadUrl).toContain('signature')
    expect(upload.avatarRef).toMatch(/^avatars\/7f3a9c2e15\//)
    expect(upload.expiresInSeconds).toBeGreaterThan(0)
  })

  it('refuses when there is no profile to attach an avatar to', async () => {
    const storage = new FakeAvatarStorage()

    await expect(
      startAvatarUpload(new InMemoryProfileRepository(), storage)('nobody'),
    ).rejects.toThrow(ProfileNotFoundError)
    expect(storage.authorised).toEqual([])
  })

  it('does not change the profile — setting avatarRef stays updateProfile\u2019s job', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())

    await startAvatarUpload(repository, new FakeAvatarStorage())('7f3a9c2e15')

    expect((await repository.findById('7f3a9c2e15'))?.avatarRef).toBeUndefined()
  })
})
