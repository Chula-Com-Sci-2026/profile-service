import { DeleteObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { PhotoStorage, PhotoUpload } from '../application/ports/photo-storage.ts'
import { isPhotoKeyOf, newPhotoKey } from './photo-key.ts'

export type ObjectStorageOptions = {
  /** Where this service reaches the store. Inside compose, `http://minio:9000`. */
  endpoint: string
  /**
   * Where the *client* reaches it — `http://localhost:9000` from a browser.
   *
   * A presigned URL is signed over its host, so signing with the internal name produces a URL
   * nobody outside the network can use, and rewriting the host afterwards breaks the signature.
   * Two clients, one for operations and one for signing, is the way out.
   */
  publicEndpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  uploadExpiresInSeconds: number
  /** How long one call to storage may take to connect, and to answer. A test seam; 2 000 ms otherwise. */
  budgetMs?: number
}

/**
 * Without a budget the SDK waits as long as the OS does: a store whose packets are dropped rather
 * than refused holds a runner's request for about two minutes. With one, a photo route answers 503
 * instead — the same two seconds a database query gets.
 */
const BUDGET_MS = 2_000

/** What the SDK reports for an object that is not there: a HEAD answers with no body to name it. */
function isNotFound(error: unknown): boolean {
  return (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode === 404
}

/**
 * MinIO over the S3 API. The same code runs against real S3 by changing an endpoint — the
 * dependency is on a protocol, not a vendor.
 */
export function createPhotoStorage(options: ObjectStorageOptions): PhotoStorage {
  const shared = {
    region: 'us-east-1', // MinIO ignores it; the SDK insists on one.
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    forcePathStyle: true, // bucket in the path, not a subdomain nobody resolves
  }
  const budgetMs = options.budgetMs ?? BUDGET_MS
  // One attempt: a runner waiting on a photo route is better told "try again" than kept for three.
  const operations = new S3Client({
    ...shared,
    endpoint: options.endpoint,
    maxAttempts: 1,
    requestHandler: { connectionTimeout: budgetMs, requestTimeout: budgetMs, throwOnRequestTimeout: true },
  })
  // Signing is a local computation: this client never reaches the network.
  const signing = new S3Client({ ...shared, endpoint: options.publicEndpoint })

  return {
    createUpload: async (id): Promise<PhotoUpload> => {
      // Signing would succeed with storage down, and the browser's upload would then fail with a
      // network error the frontend cannot explain. Asking first turns that into a 503 here.
      await operations.send(new HeadBucketCommand({ Bucket: options.bucket }))
      const photoRef = newPhotoKey(id)
      const uploadUrl = await getSignedUrl(signing, new PutObjectCommand({ Bucket: options.bucket, Key: photoRef }), {
        expiresIn: options.uploadExpiresInSeconds,
      })
      return { uploadUrl, photoRef, expiresInSeconds: options.uploadExpiresInSeconds }
    },

    holds: async (id, photoRef) => {
      // The key came from a request body. Anything but a key minted for this runner — another
      // runner's, or one that climbs out of this runner's folder — is no photo of theirs, whether
      // or not it exists, and storage is not asked about it at all.
      if (!isPhotoKeyOf(id, photoRef)) return false
      try {
        await operations.send(new HeadObjectCommand({ Bucket: options.bucket, Key: photoRef }))
        return true
      } catch (error) {
        if (isNotFound(error)) return false
        throw error
      }
    },

    remove: async (id, photoRef) => {
      // Only keys a profile held reach here, and a profile only holds keys attach accepted — but a
      // key minted for this runner is the proof of ownership, so it is checked where the deleting
      // happens.
      if (!isPhotoKeyOf(id, photoRef)) {
        throw new Error(`refusing to remove ${photoRef}: it is not a photo key minted for ${id}`)
      }
      await operations.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: photoRef }))
    },
  }
}
