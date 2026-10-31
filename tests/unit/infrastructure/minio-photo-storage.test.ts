import { afterEach, describe, expect, it } from 'vitest'
import { createPhotoStorage } from '../../../src/infrastructure/minio-photo-storage.ts'
import { localServer, type Reply } from './local-server.ts'

const RAY = '11111111-1111-4111-8111-111111111111'
const BEAM = '44444444-4444-4444-8444-444444444444'
const KEY_SHAPE = /^photos\/11111111-1111-4111-8111-111111111111\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Keys in the shape this adapter mints: `photos/{id}/{uuid}`. */
const MINE = `photos/${RAY}/0b5f3c1e-7d2a-4e9b-8f61-2c4d6e8a0b1c`
const MISSING = `photos/${RAY}/743e3a4e-7d97-431d-9fdf-bf7df238ee34`
const THEIRS = `photos/${BEAM}/0b5f3c1e-7d2a-4e9b-8f61-2c4d6e8a0b1c`

const options = {
  publicEndpoint: 'http://localhost:9000',
  bucket: 'profile-service',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  uploadExpiresInSeconds: 300,
}

/** What storage was asked, as method and path — the SDK adds query parameters of its own. */
const asked = (received: readonly { method: string; url: string }[]): string[] =>
  received.map((request) => `${request.method} ${new URL(request.url, 'http://storage.test').pathname}`)

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

/** Object storage, as far as this adapter can tell: a server answering HEADs as it is told. */
async function storageAnswering(respond: (method: string, url: string) => Reply) {
  const server = await localServer((received) => respond(received.method, received.url))
  closers.push(server.close)
  const storage = createPhotoStorage({ ...options, endpoint: server.url.replace(/\/$/, ''), budgetMs: 200 })
  return { storage, received: server.received }
}

describe('the key it mints', () => {
  it('is photos/{id}/{uuid}, and different every time, so a replaced photo cannot hit a cached copy', async () => {
    const { storage } = await storageAnswering(() => ({ status: 200 }))
    const first = await storage.createUpload(RAY)
    const second = await storage.createUpload(RAY)
    expect(first.photoRef).toMatch(KEY_SHAPE)
    expect(first.photoRef).not.toBe(second.photoRef)
  })

  it('stays inside §4’s 128 characters for photoRef', async () => {
    const { storage } = await storageAnswering(() => ({ status: 200 }))
    expect([...(await storage.createUpload(RAY)).photoRef].length).toBeLessThanOrEqual(128)
  })
})

describe('the URL it signs', () => {
  it('points at the public endpoint, not the one only this service can reach', async () => {
    const { storage } = await storageAnswering(() => ({ status: 200 }))
    const { uploadUrl } = await storage.createUpload(RAY)
    // Signed over its host: signing with the internal name would produce a URL no browser can
    // use, and rewriting the host afterwards would break the signature.
    expect(uploadUrl.startsWith('http://localhost:9000/profile-service/photos/')).toBe(true)
  })

  it('carries a signature and an expiry', async () => {
    const { storage } = await storageAnswering(() => ({ status: 200 }))
    const { uploadUrl, expiresInSeconds } = await storage.createUpload(RAY)
    expect(uploadUrl).toContain('X-Amz-Signature=')
    expect(uploadUrl).toContain('X-Amz-Expires=300')
    expect(expiresInSeconds).toBe(300)
  })

  it('does not stutter the bucket name into the path', async () => {
    const { storage } = await storageAnswering(() => ({ status: 200 }))
    expect((await storage.createUpload(RAY)).uploadUrl).not.toContain('/photos/photos/')
  })
})

describe('createUpload asks storage first (Q4)', () => {
  it('asks whether the bucket answers before it signs', async () => {
    const { storage, received } = await storageAnswering(() => ({ status: 200 }))
    await storage.createUpload(RAY)
    expect(asked(received)).toEqual(['HEAD /profile-service/'])
  })

  it('rejects when storage answers with an error', async () => {
    const { storage } = await storageAnswering(() => ({ status: 503 }))
    await expect(storage.createUpload(RAY)).rejects.toThrow()
  })

  it('rejects within its budget when storage never answers, rather than hanging the request', async () => {
    const { storage } = await storageAnswering(() => 'hang')
    const started = Date.now()
    await expect(storage.createUpload(RAY)).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(1_500)
  })
})

describe('holds — was this runner’s photo uploaded?', () => {
  it('is true when the object is there', async () => {
    const { storage, received } = await storageAnswering(() => ({ status: 200 }))
    expect(await storage.holds(RAY, MINE)).toBe(true)
    expect(asked(received)).toEqual([`HEAD /profile-service/${MINE}`])
  })

  it('is false when the object is not', async () => {
    const { storage } = await storageAnswering(() => ({ status: 404 }))
    expect(await storage.holds(RAY, MISSING)).toBe(false)
  })

  it('is false for another runner’s key, without asking storage at all', async () => {
    const { storage, received } = await storageAnswering(() => ({ status: 200 }))
    expect(await storage.holds(RAY, THEIRS)).toBe(false)
    expect(received).toEqual([])
  })

  it('rejects when storage cannot say', async () => {
    const { storage } = await storageAnswering(() => ({ status: 500 }))
    await expect(storage.holds(RAY, MINE)).rejects.toThrow()
  })
})

describe('only a key this service minted for the runner is theirs', () => {
  // A raw prefix is not proof: the SDK sends a key as it is, and a store that normalises paths would
  // resolve these into another runner's folder — or, like MinIO, refuse them as a fault.
  const forged = [
    ['a dot segment climbing into another runner’s folder', `photos/${RAY}/../${BEAM}/0b5f3c1e-7d2a-4e9b-8f61-2c4d6e8a0b1c`],
    ['an empty segment', `photos/${RAY}//x`],
    ['something that is not a uuid', `photos/${RAY}/not-a-uuid`],
    ['a uuid in uppercase, which randomUUID never mints', `photos/${RAY}/0B5F3C1E-7D2A-4E9B-8F61-2C4D6E8A0B1C`],
    ['a segment after the uuid', `${MINE}/x`],
  ] as const

  it.each(forged)('holds is false for %s, without asking storage', async (_, key) => {
    const { storage, received } = await storageAnswering(() => ({ status: 200 }))
    expect(await storage.holds(RAY, key)).toBe(false)
    expect(received).toEqual([])
  })

  it.each(forged)('remove refuses %s, without asking storage', async (_, key) => {
    const { storage, received } = await storageAnswering(() => ({ status: 204 }))
    await expect(storage.remove(RAY, key)).rejects.toThrow(/refusing to remove/)
    expect(received).toEqual([])
  })
})

describe('remove', () => {
  it('refuses a key outside the runner’s prefix, without asking storage', async () => {
    const { storage, received } = await storageAnswering(() => ({ status: 204 }))
    await expect(storage.remove(RAY, THEIRS)).rejects.toThrow(/refusing to remove/)
    expect(received).toEqual([])
  })

  it('deletes a key of the runner’s', async () => {
    const { storage, received } = await storageAnswering(() => ({ status: 204 }))
    await storage.remove(RAY, MINE)
    expect(asked(received)).toEqual([`DELETE /profile-service/${MINE}`])
  })
})
