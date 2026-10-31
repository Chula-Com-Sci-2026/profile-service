import { stdSerializers } from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { Area } from '../../../src/domain/area.ts'
import { Profile } from '../../../src/domain/profile.ts'
import { EventNotDeliveredError, httpProfileEvents, logUndelivered } from '../../../src/infrastructure/http-profile-events.ts'
import { identityServiceTokens, ServiceTokenError } from '../../../src/infrastructure/identity-service-tokens.ts'
import type { ServiceTokens } from '../../../src/infrastructure/identity-service-tokens.ts'
import { localServer, type Reply } from './local-server.ts'

const nok = new Profile({
  userId: '7f3a9c2e15',
  displayName: 'Nok',
  birthYear: 1994,
  area: new Area(13.731723456, 100.541532),
  gear: [],
  hiddenFields: [],
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
  it('POSTs the CloudEvent with the service token and the correlation id', async () => {
    const server = await discovery(() => ({ status: 202 }))
    const publisher = httpProfileEvents({
      subscribers: [server.url],
      tokens: tokens().fake,
      currentCorrelationId: () => 'abcdef01-2345-4678-89ab-cdef01234567',
      ...fast,
    })

    await publisher.updated(nok)

    const [request] = server.received
    expect(request?.headers['authorization']).toBe('Bearer t1')
    expect(request?.headers['content-type']).toBe('application/cloudevents+json')
    expect(request?.headers['x-correlation-id']).toBe('abcdef01-2345-4678-89ab-cdef01234567')
    expect(request?.headers['x-request-id']).toBeUndefined()
    expect(JSON.parse(request?.body ?? '{}')).toMatchObject({ type: 'ProfileUpdated', subject: '7f3a9c2e15' })
  })

  it('mints a correlation id when there is no request behind the event', async () => {
    const server = await discovery(() => ({ status: 204 }))
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: tokens().fake, currentCorrelationId: () => undefined, ...fast })

    await publisher.updated(nok)

    expect(server.received[0]?.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('sends ProfileDeleted naming the runner', async () => {
    const server = await discovery(() => ({ status: 200 }))
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: tokens().fake, currentCorrelationId: () => 'r', ...fast })

    await publisher.deleted('7f3a9c2e15')

    expect(JSON.parse(server.received[0]?.body ?? '{}')).toMatchObject({ type: 'ProfileDeleted', subject: '7f3a9c2e15' })
  })

  it('gives every subscriber the same event, so each can deduplicate by id', async () => {
    const one = await discovery(() => ({ status: 202 }))
    const two = await discovery(() => ({ status: 202 }))
    const publisher = httpProfileEvents({ subscribers: [one.url, two.url], tokens: tokens().fake, currentCorrelationId: () => 'r', ...fast })

    await publisher.updated(nok)

    expect(JSON.parse(one.received[0]?.body ?? '{}').id).toBe(JSON.parse(two.received[0]?.body ?? '{}').id)
  })
})

describe('httpProfileEvents — retrying (ADR-0019: a short timeout and a few retries)', () => {
  it('delivers on a later attempt after a 503', async () => {
    const server = await discovery((index) => ({ status: index === 0 ? 503 : 202 }))
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: tokens().fake, currentCorrelationId: () => 'r', ...fast })

    await publisher.updated(nok)

    expect(server.received).toHaveLength(2)
  })

  it('gives up after three attempts, saying what was lost and nothing of the profile', async () => {
    const server = await discovery(() => ({ status: 503 }))
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: tokens().fake, currentCorrelationId: () => 'abc123', ...fast })

    const error = await publisher.updated(nok).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(EventNotDeliveredError)
    expect(error).toMatchObject({ eventType: 'ProfileUpdated', subject: '7f3a9c2e15', attempts: 3, status: 503, correlationId: 'abc123' })
    const logged = JSON.stringify(stdSerializers.err(error as Error))
    expect(logged).not.toContain('13.73')
    expect(logged).not.toContain('Nok')
    expect(server.received).toHaveLength(3)
  })

  it('does not retry a 400 — asking again will not change the answer', async () => {
    const server = await discovery(() => ({ status: 400 }))
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: tokens().fake, currentCorrelationId: () => 'r', ...fast })

    await expect(publisher.updated(nok)).rejects.toMatchObject({ attempts: 1, status: 400 })
    expect(server.received).toHaveLength(1)
  })

  it('on a 401, forgets the token and tries again with a fresh one', async () => {
    const server = await discovery((index) => ({ status: index === 0 ? 401 : 204 }))
    const { fake, asked } = tokens()
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: fake, currentCorrelationId: () => 'r', ...fast })

    await publisher.updated(nok)

    expect(asked.invalidate).toBe(1)
    expect(server.received).toHaveLength(2)
  })

  it('holds the request for at most three timeouts when the subscriber hangs', async () => {
    const server = await discovery(() => 'hang')
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: tokens().fake, currentCorrelationId: () => 'r', ...fast })

    const started = Date.now()
    await expect(publisher.updated(nok)).rejects.toMatchObject({ attempts: 3, status: undefined })
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('reports the event undelivered when Identity will not issue a token', async () => {
    const server = await discovery(() => ({ status: 202 }))
    const failing = tokens(async () => {
      throw new Error('Identity is down')
    })
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: failing.fake, currentCorrelationId: () => 'r', ...fast })

    await expect(publisher.updated(nok)).rejects.toMatchObject({ attempts: 3 })
    expect(server.received).toHaveLength(0)
  })
})

describe('httpProfileEvents — saying which step failed', () => {
  it('blames the token when Identity refuses, not the subscriber', async () => {
    const server = await discovery(() => ({ status: 202 }))
    const refusing = tokens(async () => {
      throw new ServiceTokenError('Identity refused a service token: 401')
    })
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: refusing.fake, currentCorrelationId: () => 'r', ...fast })

    const error = await publisher.updated(nok).catch((e: unknown) => e)

    expect(error).toMatchObject({ stage: 'token' })
    expect((error as Error).message).toContain('Identity refused a service token: 401')
  })

  it('blames delivery when the subscriber keeps refusing', async () => {
    const server = await discovery(() => ({ status: 503 }))
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: tokens().fake, currentCorrelationId: () => 'r', ...fast })

    const error = await publisher.updated(nok).catch((e: unknown) => e)

    expect(error).toMatchObject({ stage: 'delivery', status: 503 })
    expect((error as Error).message).toContain('503')
  })
})

describe('httpProfileEvents — one deadline per attempt', () => {
  it('counts a slow token against the same timeout as the POST', async () => {
    const identity = await localServer(() => 'hang')
    closers.push(identity.close)
    const server = await discovery(() => ({ status: 202 }))
    const publisher = httpProfileEvents({
      subscribers: [server.url],
      tokens: identityServiceTokens({ tokenUrl: identity.url, clientId: 'profile-service', clientSecret: 'secret' }),
      currentCorrelationId: () => 'r',
      ...fast,
    })

    const started = Date.now()
    await expect(publisher.updated(nok)).rejects.toMatchObject({ attempts: 3, stage: 'token' })
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})

describe('logUndelivered — the log line for a lost event', () => {
  it('carries the correlation id at the top level, so it joins the request that caused it (NFR-7.4)', async () => {
    const server = await discovery(() => ({ status: 503 }))
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: tokens().fake, currentCorrelationId: () => 'abc123', ...fast })
    const error = await publisher.updated(nok).catch((e: unknown) => e)
    const lines: { fields: Record<string, unknown>; message: string }[] = []

    logUndelivered({ error: (fields, message) => lines.push({ fields: fields as Record<string, unknown>, message }) }, () => undefined)(
      '7f3a9c2e15',
      error,
    )

    expect(lines).toEqual([
      { fields: { err: error, userId: '7f3a9c2e15', correlationId: 'abc123' }, message: 'a profile event was not delivered' },
    ])
  })

  it('falls back to the current correlation id for any other failure', () => {
    const lines: Record<string, unknown>[] = []
    logUndelivered({ error: (fields) => lines.push(fields as Record<string, unknown>) }, () => 'xyz789')('7f3a9c2e15', new Error('boom'))
    expect(lines[0]?.['correlationId']).toBe('xyz789')
  })
})

describe('EventNotDeliveredError — as pino writes it', () => {
  it('keeps the event type, which pino would overwrite with the class name under `type`', async () => {
    const server = await discovery(() => ({ status: 400 }))
    const publisher = httpProfileEvents({ subscribers: [server.url], tokens: tokens().fake, currentCorrelationId: () => 'r', ...fast })

    const error = await publisher.updated(nok).catch((e: unknown) => e)
    const logged = stdSerializers.err(error as Error) as unknown as Record<string, unknown>

    expect(logged['type']).toBe('EventNotDeliveredError')
    expect(logged['eventType']).toBe('ProfileUpdated')
  })
})

describe('httpProfileEvents — several subscribers failing', () => {
  it('reports every subscriber that failed, not only the first', async () => {
    const one = await discovery(() => ({ status: 503 }))
    const two = await discovery(() => ({ status: 400 }))
    const publisher = httpProfileEvents({ subscribers: [one.url, two.url], tokens: tokens().fake, currentCorrelationId: () => 'abc123', ...fast })

    const error = await publisher.updated(nok).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AggregateError)
    const failures = (error as AggregateError).errors as EventNotDeliveredError[]
    expect(failures.map((f) => f.subscriber)).toEqual([one.url, two.url])
    expect(failures.map((f) => f.status)).toEqual([503, 400])
  })

  it('still reports a single failure as itself', async () => {
    const up = await discovery(() => ({ status: 202 }))
    const down = await discovery(() => ({ status: 400 }))
    const publisher = httpProfileEvents({ subscribers: [up.url, down.url], tokens: tokens().fake, currentCorrelationId: () => 'r', ...fast })

    await expect(publisher.updated(nok)).rejects.toBeInstanceOf(EventNotDeliveredError)
  })

  it('logs one line per subscriber that failed, each with the correlation id', async () => {
    const one = await discovery(() => ({ status: 503 }))
    const two = await discovery(() => ({ status: 503 }))
    const publisher = httpProfileEvents({ subscribers: [one.url, two.url], tokens: tokens().fake, currentCorrelationId: () => 'abc123', ...fast })
    const error = await publisher.updated(nok).catch((e: unknown) => e)
    const lines: Record<string, unknown>[] = []

    logUndelivered({ error: (fields) => lines.push(fields as Record<string, unknown>) }, () => undefined)('7f3a9c2e15', error)

    expect(lines).toHaveLength(2)
    expect(lines.map((line) => (line['err'] as EventNotDeliveredError).subscriber)).toEqual([one.url, two.url])
    expect(lines.map((line) => line['correlationId'])).toEqual(['abc123', 'abc123'])
  })
})
