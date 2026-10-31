import { describe, expect, it } from 'vitest'
import { photoUrlFor } from '../../../src/infrastructure/photo-url.ts'

const KEY = 'photos/11111111-1111-4111-8111-111111111111/0b5f3c1e-7d2a-4e9b-8f61-2c4d6e8a0b1c'

describe('photoUrlFor — {OBJECT_STORAGE_PUBLIC_ENDPOINT}/{OBJECT_STORAGE_BUCKET}/{photoRef}', () => {
  it('is the public endpoint, the bucket, then the key — path style', () => {
    const photoUrl = photoUrlFor({ publicEndpoint: 'http://localhost:9000', bucket: 'profile-service' })
    expect(photoUrl(KEY)).toBe(`http://localhost:9000/profile-service/${KEY}`)
  })

  it('does not double a slash the endpoint already ends with', () => {
    const photoUrl = photoUrlFor({ publicEndpoint: 'http://localhost:9000/', bucket: 'profile-service' })
    expect(photoUrl(KEY)).toBe(`http://localhost:9000/profile-service/${KEY}`)
  })
})
