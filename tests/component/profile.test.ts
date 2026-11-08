import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expectContract } from '../integration/contract.ts'
import { expectProfileEvent } from '../unit/infrastructure/event-contract.ts'
import { listenForProfileUpdated, type ProfileUpdatedQueue } from './broker.ts'
import { aProfile, aRunner, documentedBody } from './client.ts'

const ME = '/api/v1/me/profile'

/** The test's own queue on cra.events, bound before any scenario acts; unset if `beforeAll` failed. */
let events: ProfileUpdatedQueue

beforeAll(async () => {
  events = await listenForProfileUpdated()
})

afterAll(async () => {
  await events?.close()
})

describe('Saving and viewing', () => {
  it('Ray saves a profile; Ray sees all of it, Mali sees the public card, and the event goes out', async () => {
    // Given Ray has no profile
    const ray = await aRunner()
    const mali = await aRunner()
    await expectContract('getProfile', 404, await ray.get(ME))

    // When Ray saves one, with a name, pace, experience, area, availability and a point
    await expectContract('saveProfile', 200, await ray.put(ME, aProfile({ latitude: 13.7308, longitude: 100.5418 })))

    // Then Ray reads it back as the owner, point included
    const own = await documentedBody('getProfile', 200, await ray.get(ME))
    expect(own).toMatchObject({ id: ray.id, latitude: 13.7308, longitude: 100.5418 })

    // And Mali reads Ray's public card: the area cell, never the point
    const card = await documentedBody('getPublicProfile', 200, await mali.get(`/api/v1/runners/${ray.id}`))
    expect(card['areaCell']).toEqual({ latitude: 13.73, longitude: 100.54 })
    expect(card).not.toHaveProperty('latitude')
    expect(card).not.toHaveProperty('longitude')

    // And a ProfileUpdated about Ray reaches the test's queue, as docs/profile-events.schema.json says
    expectProfileEvent(await events.next({ id: ray.id, revision: 1 }))
  })
})

describe('Hiding a field', () => {
  it('Ray hides pace; Mali sees it null, and so does the next event', async () => {
    // Given Ray has a profile
    const ray = await aRunner()
    const mali = await aRunner()
    await expectContract('saveProfile', 200, await ray.put(ME, aProfile()))

    // When Ray hides pace
    await expectContract('setFieldVisibility', 200, await ray.put(`${ME}/visibility`, { hiddenFields: ['pace'] }))

    // Then Mali's view of Ray's card has a null pace
    const card = await documentedBody('getPublicProfile', 200, await mali.get(`/api/v1/runners/${ray.id}`))
    expect(card).toMatchObject({ paceMin: null, paceMax: null })

    // And the next event about Ray has it null too
    const event = await events.next({ id: ray.id, revision: 2 })
    expect(event.payload).toMatchObject({ paceMin: null, paceMax: null })
  })
})
