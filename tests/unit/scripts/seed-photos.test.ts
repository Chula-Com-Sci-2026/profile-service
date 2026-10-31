import { describe, expect, it } from 'vitest'
import { StorageUnavailableError } from '../../../src/application/errors.ts'
import { Profile } from '../../../src/domain/profile.ts'
import { seedPhotos, type PhotoSeeding } from '../../../scripts/seed-photos.ts'

const RAY = '11111111-1111-4111-8111-111111111111'
const BEAM = '44444444-4444-4444-8444-444444444444'
const PLOY = '55555555-5555-4555-8555-555555555555'
const BYTES = new Uint8Array([137, 80, 78, 71])

/** A seeding where Beam and Ploy have photos and Ray has none, recording every call. */
function aSeeding(overrides: Partial<PhotoSeeding> = {}) {
  const calls = { uploads: [] as string[], puts: [] as string[], attached: [] as string[], warnings: [] as string[] }
  const seeding: PhotoSeeding = {
    createPhotoUpload: async (id) => {
      calls.uploads.push(id)
      return { uploadUrl: `http://storage.test/${id}`, photoRef: `photos/${id}/abc`, expiresInSeconds: 300 }
    },
    attachPhoto: async (id, photoRef) => {
      calls.attached.push(photoRef)
      return Profile.create(id, {
        name: 'x',
        paceMin: 5,
        paceMax: 6,
        experience: 'Beginner',
        area: 'x',
        latitude: 0,
        longitude: 0,
        availability: 'x',
      }).attachPhoto(photoRef)
    },
    photoOf: (id) => (id === RAY ? undefined : BYTES),
    put: async (url) => {
      calls.puts.push(url)
      return { ok: true, status: 200 }
    },
    log: () => {},
    warn: (line) => calls.warnings.push(line),
    ...overrides,
  }
  return { seeding, calls }
}

describe('seedPhotos', () => {
  it('uploads and attaches each runner’s photo the way a client would', async () => {
    const { seeding, calls } = aSeeding()

    expect(await seedPhotos([RAY, BEAM, PLOY], seeding)).toBe(2)
    expect(calls.uploads).toEqual([BEAM, PLOY])
    expect(calls.puts).toEqual([`http://storage.test/${BEAM}`, `http://storage.test/${PLOY}`])
    expect(calls.attached).toEqual([`photos/${BEAM}/abc`, `photos/${PLOY}/abc`])
    expect(calls.warnings).toEqual([])
  })

  it('skips every photo with one warning when storage is unreachable, rather than stopping', async () => {
    const { seeding, calls } = aSeeding({
      createPhotoUpload: () => Promise.reject(new StorageUnavailableError(new Error('connect ECONNREFUSED'))),
    })

    expect(await seedPhotos([RAY, BEAM, PLOY], seeding)).toBe(0)
    expect(calls.warnings).toHaveLength(1)
    expect(calls.puts).toEqual([])
    expect(calls.attached).toEqual([])
  })

  it('skips the rest with one warning when the upload itself cannot reach storage', async () => {
    const { seeding, calls } = aSeeding({
      put: () => Promise.reject(new StorageUnavailableError(new TypeError('fetch failed'))),
    })

    expect(await seedPhotos([BEAM, PLOY], seeding)).toBe(0)
    expect(calls.warnings).toHaveLength(1)
    expect(calls.attached).toEqual([])
  })

  it('stops on an upload storage answered and refused — that is a misconfiguration, not an outage', async () => {
    const { seeding } = aSeeding({ put: async () => ({ ok: false, status: 403 }) })
    await expect(seedPhotos([BEAM], seeding)).rejects.toThrow(/403/)
  })
})
