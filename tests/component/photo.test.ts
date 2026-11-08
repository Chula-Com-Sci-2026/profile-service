import { describe, expect, inject, it } from 'vitest'
import { expectContract } from '../integration/contract.ts'
import { aProfile, aRunner, documentedBody } from './client.ts'
import { BUCKET } from './stack.ts'

const ME = '/api/v1/me/profile'
const { storageUrl } = inject('component')

/** A 1×1 PNG. Storage never looks inside; what matters is that the same bytes come back. */
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/** A response's status, with its body discarded so no socket is left waiting on it. */
async function statusOf(response: Response): Promise<number> {
  await response.body?.cancel()
  return response.status
}

describe('A photo through real storage', () => {
  it("Ray's photo goes straight to storage, loads anonymously and goes away when removed", async () => {
    // Given Ray has a profile
    const ray = await aRunner()
    await expectContract('saveProfile', 200, await ray.put(ME, aProfile()))

    // When Ray asks for an upload link, PUTs the image straight to storage with no token, and
    // attaches the key the link was made for
    const upload = await documentedBody<{ uploadUrl: string; photoRef: string }>(
      'createPhotoUpload',
      201,
      await ray.post(`${ME}/photo-uploads`),
    )
    // The link is signed for the storage address a client uses — the service's public endpoint,
    // which here is this test process's — not the in-network name the service itself reaches
    expect(new URL(upload.uploadUrl).origin, 'where the upload link points').toBe(new URL(storageUrl).origin)
    expect(await statusOf(await fetch(upload.uploadUrl, { method: 'PUT', body: PHOTO }))).toBe(200)
    await expectContract('attachPhoto', 200, await ray.put(`${ME}/photo`, { photoRef: upload.photoRef }))

    // Then Ray's card has a photoUrl that loads with no token, and gives back the same bytes
    const card = await documentedBody<{ photoUrl: string | null }>('getPublicProfile', 200, await ray.get(`/api/v1/runners/${ray.id}`))
    const photoUrl = card.photoUrl ?? expect.unreachable("Ray's card has no photoUrl")
    const loaded = await fetch(photoUrl)
    expect(loaded.status).toBe(200)
    expect(Buffer.from(await loaded.arrayBuffer()).equals(PHOTO), 'the photo loads with the bytes uploaded').toBe(true)

    // And nobody can list the bucket anonymously, so the keys — and who has a photo — stay unknown
    expect(await statusOf(await fetch(`${storageUrl}/${BUCKET}/`)), 'an anonymous listing of the bucket').toBe(403)

    // When Ray removes the photo
    await expectContract('removePhoto', 200, await ray.delete(`${ME}/photo`))

    // Then the card's photoUrl is null, and the object is gone from storage
    expect(await documentedBody('getPublicProfile', 200, await ray.get(`/api/v1/runners/${ray.id}`))).toMatchObject({
      photoUrl: null,
    })
    expect(await statusOf(await fetch(photoUrl)), 'the removed photo, asked for anonymously').toBe(404)
  })
})
