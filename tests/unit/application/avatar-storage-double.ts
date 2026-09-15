import type { AvatarStorage, AvatarUpload } from '../../../src/application/ports/avatar-storage.ts'

/** Records what it was asked to do, and can be told to fail. */
export class FakeAvatarStorage implements AvatarStorage {
  readonly removed: string[] = []
  readonly removedKeys: string[] = []
  authorised: string[] = []
  failOnRemove = false

  async authoriseUpload(userId: string): Promise<AvatarUpload> {
    this.authorised.push(userId)
    return {
      uploadUrl: `http://storage.test/avatars/${userId}/abc?signature=x`,
      avatarRef: `avatars/${userId}/abc`,
      expiresInSeconds: 300,
    }
  }

  async remove(userId: string, avatarRef: string): Promise<void> {
    if (this.failOnRemove) throw new Error('storage is unreachable')
    // The real adapter refuses a key outside the runner's prefix; so does this one, or a test
    // could pass while the thing it stands in for would throw.
    if (!avatarRef.startsWith(`avatars/${userId}/`)) {
      throw new Error(`refusing to remove ${avatarRef}: it is outside avatars/${userId}/`)
    }
    this.removedKeys.push(avatarRef)
  }

  async removeAll(userId: string): Promise<void> {
    if (this.failOnRemove) throw new Error('storage is unreachable')
    this.removed.push(userId)
  }
}
