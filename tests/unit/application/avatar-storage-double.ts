import type { AvatarStorage, AvatarUpload } from '../../../src/application/avatar-storage.ts'

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

  async remove(avatarRef: string): Promise<void> {
    if (this.failOnRemove) throw new Error('storage is unreachable')
    this.removedKeys.push(avatarRef)
  }

  async removeAll(userId: string): Promise<void> {
    if (this.failOnRemove) throw new Error('storage is unreachable')
    this.removed.push(userId)
  }
}
