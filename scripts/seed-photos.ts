import type { AttachPhoto } from '../src/application/attach-photo.ts'
import type { CreatePhotoUpload } from '../src/application/create-photo-upload.ts'
import { StorageUnavailableError } from '../src/application/errors.ts'

/** What seeding photos needs, so the rule below can be tested without storage or files. */
export type PhotoSeeding = {
  createPhotoUpload: CreatePhotoUpload
  attachPhoto: AttachPhoto
  /** The runner's photo, or undefined when they have none. */
  photoOf: (id: string) => Uint8Array | undefined
  /** PUT the bytes to a signed upload URL. Rejects with StorageUnavailableError when it cannot reach storage. */
  put: (url: string, bytes: Uint8Array) => Promise<{ ok: boolean; status: number }>
  log: (line: string) => void
  warn: (line: string) => void
}

/**
 * PUTs a seed photo to a signed upload URL, as a browser would, with its content type. The
 * signature does not cover the type, so storage keeps whatever the upload says and serves the photo
 * back with it — without one, MinIO answers `binary/octet-stream`. The seed's photos are PNG files.
 * Rejects with StorageUnavailableError when it cannot reach storage.
 */
export function putPhoto(url: string, bytes: Uint8Array): Promise<{ ok: boolean; status: number }> {
  return fetch(url, { method: 'PUT', body: bytes, headers: { 'content-type': 'image/png' } }).catch((error: unknown) => {
    throw new StorageUnavailableError(error)
  })
}

/**
 * Seeds photos the way a client adds one: ask for an upload link, PUT the bytes to it, then attach
 * the key it minted. No shortcut through the S3 client, so seeding exercises the handshake the API
 * offers — and the key cannot be written into seed.json, because it carries a uuid that exists only
 * once the upload is authorised.
 *
 * Storage being unreachable costs the photos and nothing else: one warning, and the runners are
 * left seeded without them, rather than the seed stopping at the first upload. Storage answering
 * and refusing is a misconfiguration, not an outage, so that still stops it.
 *
 * Returns how many photos were attached.
 */
export async function seedPhotos(ids: readonly string[], seeding: PhotoSeeding): Promise<number> {
  let attached = 0
  for (const id of ids) {
    const bytes = seeding.photoOf(id)
    if (bytes === undefined) continue
    try {
      const { uploadUrl, photoRef } = await seeding.createPhotoUpload(id)
      const uploaded = await seeding.put(uploadUrl, bytes)
      if (!uploaded.ok) throw new Error(`uploading ${id}'s photo failed: ${uploaded.status}`)
      const profile = await seeding.attachPhoto(id, photoRef)
      seeding.log(`photo   ${id}  ${profile.photoRef}`)
      attached += 1
    } catch (error) {
      if (!(error instanceof StorageUnavailableError)) throw error
      seeding.warn('object storage is unreachable: the runners are seeded without photos')
      return attached
    }
  }
  return attached
}
