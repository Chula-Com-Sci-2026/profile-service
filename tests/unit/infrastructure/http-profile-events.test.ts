import { stdSerializers } from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { Area } from '../../../src/domain/area.ts'
import { Profile } from '../../../src/domain/profile.ts'
import { EventNotDeliveredError, httpProfileEvents } from '../../../src/infrastructure/http-profile-events.ts'
import type { ServiceTokens } from '../../../src/infrastructure/identity-service-tokens.ts'
import { localServer, type Reply } from './local-server.ts'

const nok = new Profile({
  userId: '7f3a9c2e15',
  displayName: 'Nok',
  birthYear: 1994,
  area: new Area(13.731723456, 100.541532),
  preferredDistances: [],
  preferredRunTimes: [],
})

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

async function discovery(respond: (index: number) => Reply) {
  const server = await localServer((_, index) => respond(index))
  closers.push(server.close)
  return server
}

/** Counts what the publisher asked of Identity; the token client has its own tests. */
function tokens(token: () => Promise<string> = async () => 't1') {
  const asked = { token: 0, invalidate: 0 }
  const fake: ServiceTokens = {
    token: () => {
      asked.token += 1
      return token()
    },
    invalidate: () => {
      asked.invalidate += 1
    },
  }
  return { fake, asked }
}

const fast = { backoffMs: [0, 0], timeoutMs: 100 }

describe('httpProfileEvents — delivering', () => {
  it('POSTs the CloudEvent with the service token and the request id', async () => {
    const server = await discovery(() => ({ status: 202 }))
    const publisher = httpProfileEvents({
      subscribers: [server.url],
      tokens: tokens().fake,
      currentRequestId: () => 'abc123',
      ...fast,
    })

    await publisher.updated(nok)

    const [request] = server.received
    expect(request?.headers['authorization']).toBe('Bearer t1')
    expect(request?.headers['content-type']).toBe('application/cloudevents+json')
    expect(request?.headers['x-request-id']).toBe('abc123')
    expect(JSON.parse(request?.body ?? '{}')).toMatchObject({ type: 'ProfileUpdated', subject: '7f3a9c2e15' })
  })

  it('mints a request id when there is no request behind the event', async () => {
    const server = await discovery(() => ({ status: 204 }))
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: tokens().fake, currentRequestId: () => undefined, ...fast })

    await publisher.updated(nok)

    expect(server.received[0]?.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('sends ProfileDeleted naming the runner', async () => {
    const server = await discovery(() => ({ status: 200 }))
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: tokens().fake, currentRequestId: () => 'r', ...fast })

    await publisher.deleted('7f3a9c2e15')

    expect(JSON.parse(server.received[0]?.body ?? '{}')).toMatchObject({ type: 'ProfileDeleted', subject: '7f3a9c2e15' })
  })

  it('gives every subscriber the same event, so each can deduplicate by id', async () => {
    const one = await discovery(() => ({ status: 202 }))
    const two = await discovery(() => ({ status: 202 }))
    const publisher = httpProfileEvents({ subscribers: [one.url, two.url], tokens: tokens().fake, currentRequestId: () => 'r', ...fast })

    await publisher.updated(nok)

    expect(JSON.parse(one.received[0]?.body ?? '{}').id).toBe(JSON.parse(two.received[0]?.body ?? '{}').id)
  })
})

describe('httpProfileEvents — retrying (ADR-0019: a short timeout and a few retries)', () => {
  it('delivers on a later attempt after a 503', async () => {
    const server = await discovery((index) => ({ status: index === 0 ? 503 : 202 }))
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: tokens().fake, currentRequestId: () => 'r', ...fast })

    await publisher.updated(nok)

    expect(server.received).toHaveLength(2)
  })

  it('gives up after three attempts, saying what was lost and nothing of the profile', async () => {
    const server = await discovery(() => ({ status: 503 }))
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: tokens().fake, currentRequestId: () => 'abc123', ...fast })

    const error = await publisher.updated(nok).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(EventNotDeliveredError)
    expect(error).toMatchObject({ type: 'ProfileUpdated', subject: '7f3a9c2e15', attempts: 3, status: 503, requestId: 'abc123' })
    const logged = JSON.stringify(stdSerializers.err(error as Error))
    expect(logged).not.toContain('13.73')
    expect(logged).not.toContain('Nok')
    expect(server.received).toHaveLength(3)
  })

  it('does not retry a 400 — asking again will not change the answer', async () => {
    const server = await discovery(() => ({ status: 400 }))
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: tokens().fake, currentRequestId: () => 'r', ...fast })

    await expect(publisher.updated(nok)).rejects.toMatchObject({ attempts: 1, status: 400 })
    expect(server.received).toHaveLength(1)
  })

  it('on a 401, forgets the token and tries again with a fresh one', async () => {
    const server = await discovery((index) => ({ status: index === 0 ? 401 : 204 }))
    const { fake, asked } = tokens()
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: fake, currentRequestId: () => 'r', ...fast })

    await publisher.updated(nok)

    expect(asked.invalidate).toBe(1)
    expect(server.received).toHaveLength(2)
  })

  it('holds the request for at most three timeouts when the subscriber hangs', async () => {
    const server = await discovery(() => 'hang')
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: tokens().fake, currentRequestId: () => 'r', ...fast })

    const started = Date.now()
    await expect(publisher.updated(nok)).rejects.toMatchObject({ attempts: 3, status: undefined })
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('reports the event undelivered when Identity will not issue a token', async () => {
    const server = await discovery(() => ({ status: 202 }))
    const failing = tokens(async () => {
      throw new Error('Identity is down')
    })
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: failing.fake, currentRequestId: () => 'r', ...fast })

    await expect(publisher.updated(nok)).rejects.toMatchObject({ attempts: 3 })
    expect(server.received).toHaveLength(0)
  })
})
