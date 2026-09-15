import { randomUUID } from 'node:crypto'
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { AvatarStorage, AvatarUpload } from '../application/ports/avatar-storage.ts'

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
}

/**
 * MinIO over the S3 API. The same code runs against real S3 by changing an endpoint — the
 * dependency is on a protocol, not a vendor.
 */
export function createAvatarStorage(options: ObjectStorageOptions): AvatarStorage {
  const shared = {
    region: 'us-east-1', // MinIO ignores it; the SDK insists on one.
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    forcePathStyle: true, // bucket in the path, not a subdomain nobody resolves
  }
  const operations = new S3Client({ ...shared, endpoint: options.endpoint })
  const signing = new S3Client({ ...shared, endpoint: options.publicEndpoint })

  /** Every avatar a runner has shares this prefix, which is what lets deletion skip a read. */
  const prefixFor = (userId: string): string => `avatars/${userId}/`

  return {
    authoriseUpload: async (userId): Promise<AvatarUpload> => {
      // A fresh key per upload: replacing an avatar cannot collide with a cached copy of the
      // old one, and the object it replaces stays addressable until it is swept.
      const avatarRef = `${prefixFor(userId)}${randomUUID()}`
      const uploadUrl = await getSignedUrl(
        signing,
        new PutObjectCommand({ Bucket: options.bucket, Key: avatarRef }),
        { expiresIn: options.uploadExpiresInSeconds },
      )
      return { uploadUrl, avatarRef, expiresInSeconds: options.uploadExpiresInSeconds }
    },

    remove: async (userId, avatarRef) => {
      // The key came from a request body, and every profile is readable, so a runner could name
      // someone else's key and have it deleted for them. The prefix is the proof of ownership.
      if (!avatarRef.startsWith(prefixFor(userId))) {
        throw new Error(`refusing to remove ${avatarRef}: it is outside ${prefixFor(userId)}`)
      }
      await operations.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: avatarRef }))
    },

    removeAll: async (userId) => {
      // A page at a time: ListObjectsV2 returns at most a thousand keys and DeleteObjects
      // accepts at most a thousand, so without the loop a runner past that keeps the tail of
      // their images in a public bucket while this reports success.
      let continuationToken: string | undefined
      do {
        const listed = await operations.send(
          new ListObjectsV2Command({
            Bucket: options.bucket,
            Prefix: prefixFor(userId),
            ContinuationToken: continuationToken,
          }),
        )
        const keys = (listed.Contents ?? []).flatMap((object) =>
          object.Key === undefined ? [] : [{ Key: object.Key }],
        )
        if (keys.length > 0) {
          const deleted = await operations.send(
            new DeleteObjectsCommand({ Bucket: options.bucket, Delete: { Objects: keys } }),
          )
          // DeleteObjects answers 200 with a per-key Errors array rather than rejecting, so
          // without this a policy that denies deletion looks like a clean sweep and the caller
          // never logs the orphans it is relying on being told about.
          const failures = deleted.Errors ?? []
          if (failures.length > 0) {
            throw new Error(
              `could not remove ${failures.length} of ${keys.length} objects: ${failures[0]?.Key} ${failures[0]?.Message}`,
            )
          }
        }
        continuationToken = listed.IsTruncated === true ? listed.NextContinuationToken : undefined
      } while (continuationToken !== undefined)
    },
  }
}
