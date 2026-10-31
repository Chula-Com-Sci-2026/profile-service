import type { PhotoStorage, PhotoUpload } from '../../../src/application/ports/photo-storage.ts'
import { isPhotoKeyOf } from '../../../src/infrastructure/photo-key.ts'

/** A key in the shape the real adapter mints, `photos/{id}/{uuid}` — the double mints the first. */
export const keyFor = (id: string, uuid = '0b5f3c1e-7d2a-4e9b-8f61-2c4d6e8a0b1c'): string => `photos/${id}/${uuid}`

/**
 * Object storage in a Set. It keeps the real adapter's rule, through the adapter's own check — only a
 * key minted for the runner is held or removed — or a test could pass where the real thing would not.
 */
export class FakePhotoStorage implements PhotoStorage {
  /** The keys storage holds: an upload a client finished. */
  readonly objects = new Set<string>()
  readonly removedKeys: string[] = []
  /** Every runner an upload link was signed for. */
  readonly created: string[] = []
  /** Storage does not answer: every call rejects, as a dead MinIO's would. */
  unreachable = false
  /** Storage answers, but refuses to delete. */
  failOnRemove = false

  async createUpload(id: string): Promise<PhotoUpload> {
    if (this.unreachable) throw new Error('storage is unreachable')
    this.created.push(id)
    return {
      uploadUrl: `http://storage.test/profile-service/${keyFor(id)}?X-Amz-Signature=x`,
      photoRef: keyFor(id),
      expiresInSeconds: 300,
    }
  }

  async holds(id: string, photoRef: string): Promise<boolean> {
    if (!isPhotoKeyOf(id, photoRef)) return false
    if (this.unreachable) throw new Error('storage is unreachable')
    return this.objects.has(photoRef)
  }

  async remove(id: string, photoRef: string): Promise<void> {
    if (!isPhotoKeyOf(id, photoRef)) {
      throw new Error(`refusing to remove ${photoRef}: it is not a photo key minted for ${id}`)
    }
    if (this.unreachable || this.failOnRemove) throw new Error('storage is unreachable')
    this.removedKeys.push(photoRef)
    this.objects.delete(photoRef)
  }
}
