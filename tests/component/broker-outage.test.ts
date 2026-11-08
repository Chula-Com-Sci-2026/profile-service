import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expectContract } from '../integration/contract.ts'
import { listenForProfileUpdated, type ProfileUpdatedQueue, startBroker, stopBroker } from './broker.ts'
import { aProfile, aRunner } from './client.ts'
import { eventually } from './eventually.ts'

const ME = '/api/v1/me/profile'

/** The test's own queue; unset if `beforeAll` failed. */
let events: ProfileUpdatedQueue
/** Set while this file has the broker stopped, so a failure part-way still hands the next file a whole stack. */
let brokerStopped = false

beforeAll(async () => {
  events = await listenForProfileUpdated()
})

afterAll(async () => {
  await events?.close()
  // Whatever state the scenario left the broker in, the next file gets one that is running and
  // taking connections: a started container is not yet a broker that answers.
  if (brokerStopped) await startBroker()
  const ready = await eventually('the broker to take connections again', () => listenForProfileUpdated(), {
    timeoutMs: 60_000,
    intervalMs: 500,
  })
  await ready.close()
})

describe('Broker outage, outbox catches up', () => {
  it('a save made while the broker is down reaches the queue once the broker is back', async () => {
    // Given the service is running and has delivered an event, so it holds a live broker connection
    const ray = await aRunner()
    await expectContract('saveProfile', 200, await ray.put(ME, aProfile()))
    await events.next({ id: ray.id, revision: 1 })

    // And the broker is stopped — the container itself, as an outage would take it
    await events.close()
    await stopBroker()
    brokerStopped = true
    await expect(listenForProfileUpdated(), 'a connection while the broker is stopped').rejects.toThrow()

    // When Ray saves a profile
    const saved = await ray.put(ME, aProfile({ availability: 'Sat · 07:00' }))

    // Then the save succeeds: it never waits on the broker (ADR-0028)
    await expectContract('saveProfile', 200, saved)

    // And after the broker starts again, the waiting event reaches the test's queue. The queue is
    // a new one — the old, exclusive one went with the broker — and until it is bound the service's
    // publish comes back unroutable and stays in the outbox, to be tried again two seconds later.
    await startBroker()
    brokerStopped = false
    events = await eventually('the broker to take connections again', () => listenForProfileUpdated(), {
      timeoutMs: 60_000,
      intervalMs: 500,
    })
    const event = await events.next({ id: ray.id, revision: 2 }, { timeoutMs: 60_000 })
    expect(event.payload['availability']).toBe('Sat · 07:00')
  })
})
