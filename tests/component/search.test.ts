import { describe, expect, it } from 'vitest'
import { expectContract } from '../integration/contract.ts'
import { aProfile, aRunner, documentedBody } from './client.ts'

const ME = '/api/v1/me/profile'

/** A card in a search answer: the public card plus how far away it is. */
type Found = { id: string; distanceKm: number } & Record<string, unknown>

/**
 * In Chiang Mai, far from the Bangkok points the other scenarios save, and well inside their
 * 0.01° cells, so the distances between cells are unambiguous: the near runner is about 2.4 km
 * from Ray, the far one, in Lamphun, about 23 km, and Bangkok about 570 km.
 */
const RAY = { latitude: 18.7883, longitude: 98.9853 } // cell 18.79, 98.99
const NEAR = { latitude: 18.801, longitude: 98.969 } // cell 18.80, 98.97
const FAR = { latitude: 18.58, longitude: 99.008 } // cell 18.58, 99.01

describe('Searching', () => {
  it('Ray finds the runner nearby but not the one far away, nearest first, with no exact points', async () => {
    // Given Ray, a runner a short distance away and a runner far away, all with profiles
    const [ray, near, far] = await Promise.all([aRunner(), aRunner(), aRunner()])
    await expectContract('saveProfile', 200, await ray.put(ME, aProfile(RAY)))
    await expectContract('saveProfile', 200, await near.put(ME, aProfile({ name: 'Nok', ...NEAR })))
    await expectContract('saveProfile', 200, await far.put(ME, aProfile({ name: 'Beam', ...FAR })))

    // When Ray searches within 5 km
    const nearby = await documentedBody<Found[]>('searchRunners', 200, await ray.get('/api/v1/runners?radiusKm=5'))

    // Then the near runner is in the answer and the far one isn't, and Ray isn't in their own results
    const ids = nearby.map((card) => card.id)
    expect(ids).toContain(near.id)
    expect(ids).not.toContain(far.id)
    expect(ids).not.toContain(ray.id)

    // And the answer is a bare array of cards, none with an exact point
    expect(Array.isArray(nearby)).toBe(true)
    for (const card of nearby) {
      expect(card).not.toHaveProperty('latitude')
      expect(card).not.toHaveProperty('longitude')
    }

    // When Ray widens the search to 50 km
    const wider = await documentedBody<Found[]>('searchRunners', 200, await ray.get('/api/v1/runners?radiusKm=50'))

    // Then the far runner is there too, after the near one: nearest first
    const order = wider.map((card) => card.id)
    expect(order).toContain(near.id)
    expect(order).toContain(far.id)
    expect(order.indexOf(near.id)).toBeLessThan(order.indexOf(far.id))
    const distances = wider.map((card) => card.distanceKm)
    expect(distances).toEqual([...distances].sort((a, b) => a - b))
  })
})
