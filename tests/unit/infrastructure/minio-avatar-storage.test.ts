import { describe, expect, it } from 'vitest'
import { createAvatarStorage } from '../../../src/infrastructure/minio-avatar-storage.ts'

/**
 * No MinIO here, and none needed: presigning is a local computation, so the half of this adapter
 * that carries a decision can be checked for free. The half that talks to the network is thin
 * SDK plumbing and is covered end to end instead.
 */
const storage = createAvatarStorage({
  endpoint: 'http://minio:9000',
  publicEndpoint: 'http://localhost:9000',
  bucket: 'profile-service',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  uploadExpiresInSeconds: 300,
})

describe('the key it mints', () => {
  it('is avatars/{userId}/{uuid}', async () => {
    const { avatarRef } = await storage.authoriseUpload('7f3a9c2e15')
    expect(avatarRef).toMatch(
      /^avatars\/7f3a9c2e15\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('shares the prefix remove checks ownership by — the coupling that keeps one runner off another\u2019s images', async () => {
    // If an upload key ever stops starting with `avatars/{userId}/`, uploads keep working and
    // deletion silently matches nothing. Nothing else in the suite would notice.
    const { avatarRef } = await storage.authoriseUpload('b41d8e0a63')
    expect(avatarRef.startsWith('avatars/b41d8e0a63/')).toBe(true)
  })

  it('is different every time, so replacing an avatar cannot hit a cached copy', async () => {
    const first = await storage.authoriseUpload('7f3a9c2e15')
    const second = await storage.authoriseUpload('7f3a9c2e15')
    expect(first.avatarRef).not.toBe(second.avatarRef)
  })

  it('stays inside §4’s 128-character limit for avatarRef', async () => {
    const { avatarRef } = await storage.authoriseUpload('x'.repeat(64))
    expect([...avatarRef].length).toBeLessThanOrEqual(128)
  })
})

describe('the URL it signs', () => {
  it('points at the public endpoint, not the one only this service can reach', async () => {
    const { uploadUrl } = await storage.authoriseUpload('7f3a9c2e15')
    // Signed over its host: signing with http://minio:9000 would produce a URL no browser can
    // use, and rewriting the host afterwards would break the signature.
    expect(uploadUrl.startsWith('http://localhost:9000/')).toBe(true)
    expect(uploadUrl).not.toContain('minio:9000')
  })

  it('carries a signature and an expiry', async () => {
    const { uploadUrl, expiresInSeconds } = await storage.authoriseUpload('7f3a9c2e15')
    expect(uploadUrl).toContain('X-Amz-Signature=')
    expect(uploadUrl).toContain('X-Amz-Expires=300')
    expect(expiresInSeconds).toBe(300)
  })

  it('does not stutter the bucket name into the path', async () => {
    const { uploadUrl } = await storage.authoriseUpload('7f3a9c2e15')
    expect(uploadUrl).not.toContain('/avatars/avatars/')
  })
})
