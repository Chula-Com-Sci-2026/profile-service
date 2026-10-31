import type { PhotoStorage, PhotoUpload } from '../../../src/application/ports/photo-storage.ts'

/**
 * Object storage in a Set. It keeps the real adapter's rules — keys under `photos/{id}/`, nothing
 * outside a runner's prefix held or removed — or a test could pass where the real thing would not.
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
      uploadUrl: `http://storage.test/profile-service/photos/${id}/abc?X-Amz-Signature=x`,
      photoRef: `photos/${id}/abc`,
      expiresInSeconds: 300,
    }
  }

  async holds(id: string, photoRef: string): Promise<boolean> {
    if (!photoRef.startsWith(`photos/${id}/`)) return false
    if (this.unreachable) throw new Error('storage is unreachable')
    return this.objects.has(photoRef)
  }

  async remove(id: string, photoRef: string): Promise<void> {
    if (!photoRef.startsWith(`photos/${id}/`)) {
      throw new Error(`refusing to remove ${photoRef}: it is outside photos/${id}/`)
    }
    if (this.unreachable || this.failOnRemove) throw new Error('storage is unreachable')
    this.removedKeys.push(photoRef)
    this.objects.delete(photoRef)
  }
}
