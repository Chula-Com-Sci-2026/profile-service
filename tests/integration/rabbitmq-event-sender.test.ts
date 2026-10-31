import { randomUUID } from 'node:crypto'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { type Channel, type ChannelModel, connect } from 'amqplib'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import type { EventSender } from '../../src/infrastructure/event-sender.ts'
import type { ProfileUpdatedEvent } from '../../src/infrastructure/profile-published-language.ts'
import { EXCHANGE, rabbitmqEventSender, UnroutableEventError } from '../../src/infrastructure/rabbitmq-event-sender.ts'
import { expectProfileEvent } from '../unit/infrastructure/event-contract.ts'

/**
 * The sender against a real RabbitMQ, connecting as `profile` with the least-privilege grant the
 * harness gives it. The broker's own admin login checks what arrived.
 */
const broker = inject('rabbitmq')
const QUEUE = 'profile-events-check'

let admin: ChannelModel
let channel: Channel
let sender: EventSender

function anEvent(revision = 1): ProfileUpdatedEvent {
  return {
    eventId: randomUUID(),
    eventType: 'ProfileUpdated',
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    payload: {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Nok',
      area: 'Lumphini Park',
      areaCell: { latitude: 13.73, longitude: 100.54 },
      photoUrl: null,
      bio: null,
      paceMin: 7,
      paceMax: 8,
      experience: 'Beginner',
      availability: 'Sat early mornings',
      usualDistance: null,
      gear: null,
      revision,
    },
  }
}

/** The management API, as the broker's admin. */
async function management(path: string, init: RequestInit = {}): Promise<Response> {
  const login = Buffer.from(`${broker.admin.user}:${broker.admin.password}`).toString('base64')
  return fetch(`${broker.managementUrl}/api${path}`, { ...init, headers: { authorization: `Basic ${login}` } })
}

/** Sends until one is delivered, as the relay would on its next ticks; false if none is. */
async function sendsEventually(send: () => Promise<void>): Promise<boolean> {
  for (let tries = 0; tries < 20; tries += 1) {
    if (await send().then(() => true, () => false)) return true
    await delay(100)
  }
  return false
}

/** Every revision waiting in the check queue, oldest first, taking them off it. */
async function revisionsInQueue(): Promise<number[]> {
  const revisions: number[] = []
  for (let message = await channel.get(QUEUE, { noAck: true }); message !== false; message = await channel.get(QUEUE, { noAck: true })) {
    revisions.push((JSON.parse(message.content.toString('utf8')) as ProfileUpdatedEvent).payload.revision)
  }
  return revisions
}

/**
 * A TCP relay to the broker whose connections the test can cut, as a network blip would: the
 * client sees its socket reset, which amqplib reports as an `error` event on the connection.
 */
async function cuttableRoute(): Promise<{ port: number; cut: () => void; close: () => Promise<void> }> {
  const clients: Socket[] = []
  const server: Server = createServer((client) => {
    clients.push(client)
    const upstream = createConnection({ host: broker.host, port: broker.port })
    client.pipe(upstream).pipe(client)
    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
    client.on('close', () => upstream.destroy())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as { port: number }).port,
    cut: () => {
      for (const client of clients.splice(0)) client.resetAndDestroy()
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/** A consumer's side of it: the exchange, a queue, and a binding on the event's routing key. */
async function bindQueue(): Promise<void> {
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true })
  await channel.assertQueue(QUEUE, { durable: true })
  await channel.bindQueue(QUEUE, EXCHANGE, 'ProfileUpdated')
}

beforeAll(async () => {
  admin = await connect({ hostname: broker.host, port: broker.port, username: broker.admin.user, password: broker.admin.password })
  channel = await admin.createChannel()
})

afterAll(async () => {
  await admin.close()
})

beforeEach(async () => {
  await channel.deleteQueue(QUEUE)
  await channel.deleteExchange(EXCHANGE)
  sender = rabbitmqEventSender({
    host: broker.host,
    port: broker.port,
    user: broker.profile.user,
    password: broker.profile.password,
    vhost: '/',
  })
})

afterEach(async () => {
  await sender.close()
})

describe('the RabbitMQ sender, as the profile broker user', () => {
  it('declares cra.events — topic, durable — on connect, so a consumer can bind to it', async () => {
    await sender.send(anEvent()).catch(() => undefined)

    const response = await management('/exchanges/%2F/cra.events')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ name: 'cra.events', type: 'topic', durable: true })
  })

  it('rejects an event no queue is bound for, as unroutable — so its row stays', async () => {
    // Review Focus 1: the state every demo starts in, until Discovery binds its queue.
    const event = anEvent()
    const failure = await sender.send(event).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(UnroutableEventError)
    expect((failure as UnroutableEventError).eventId).toBe(event.eventId)
  })

  it('publishes to a bound queue with the routing key, persistent, as application/json, with messageId = eventId', async () => {
    await bindQueue()
    const event = anEvent()

    await sender.send(event)

    const message = await channel.get(QUEUE, { noAck: true })
    if (message === false) throw new Error('nothing reached the queue')
    expect(message.fields.routingKey).toBe('ProfileUpdated')
    expect(message.properties).toMatchObject({ deliveryMode: 2, contentType: 'application/json', messageId: event.eventId })
    const body: unknown = JSON.parse(message.content.toString('utf8'))
    expect(body).toEqual(event)
    expectProfileEvent(body)
  })

  it('after the broker closes its connection, a later send reconnects and is delivered', async () => {
    // Review Focus 2: a broker restart or a blip must cost a retry, never the process.
    await bindQueue()
    await sender.send(anEvent(1))

    // The management API lists a connection only once its statistics have been collected.
    let ours: { name: string; user: string }[] = []
    for (let tries = 0; tries < 100 && ours.length === 0; tries += 1) {
      const connections = (await (await management('/connections')).json()) as { name: string; user: string }[]
      ours = connections.filter((connection) => connection.user === broker.profile.user)
      if (ours.length === 0) await delay(100)
    }
    expect(ours.length).toBeGreaterThan(0)
    for (const connection of ours) await management(`/connections/${encodeURIComponent(connection.name)}`, { method: 'DELETE' })

    expect(await sendsEventually(() => sender.send(anEvent(2)))).toBe(true)
    expect(await revisionsInQueue()).toEqual([1, 2])
  })

  it('after the connection is cut mid-stream, a later send reconnects — the error event never goes unhandled', async () => {
    // Review Focus 2: a reset socket makes amqplib emit `error` on the connection. Unheard, that
    // event would throw and take the process down with it.
    await bindQueue()
    const route = await cuttableRoute()
    const viaRoute = rabbitmqEventSender({ ...broker.profile, host: '127.0.0.1', port: route.port, vhost: '/' })
    const unhandled: unknown[] = []
    const record = (error: unknown): void => {
      unhandled.push(error)
    }
    process.on('uncaughtException', record)
    try {
      await viaRoute.send(anEvent(1))
      route.cut()
      expect(await sendsEventually(() => viaRoute.send(anEvent(2)))).toBe(true)
    } finally {
      process.off('uncaughtException', record)
      await viaRoute.close()
      await route.close()
    }
    expect(unhandled).toEqual([])
    expect(await revisionsInQueue()).toEqual([1, 2])
  })
})
