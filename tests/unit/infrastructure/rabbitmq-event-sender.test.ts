import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProfileUpdatedEvent } from '../../../src/infrastructure/profile-published-language.ts'
import { rabbitmqEventSender } from '../../../src/infrastructure/rabbitmq-event-sender.ts'

/**
 * The sender with no broker at all, so no Docker: what a dead or wedged broker costs. The
 * integration suite holds it to a real RabbitMQ.
 */
const event: ProfileUpdatedEvent = {
  eventId: '5f0c7a8e-3b1d-4e2a-9c6f-0d8b7a6e5c4d',
  eventType: 'ProfileUpdated',
  version: 1,
  occurredAt: '2026-11-01T00:00:00.000Z',
  correlationId: 'abcdef01-2345-4678-89ab-cdef01234567',
  payload: { id: '11111111-1111-4111-8111-111111111111', revision: 1 },
}

const BUDGET_MS = 300

let server: Server | undefined
const sockets: Socket[] = []

afterEach(async () => {
  for (const socket of sockets) socket.destroy()
  sockets.length = 0
  await new Promise<void>((resolve) => (server === undefined ? resolve() : server.close(() => resolve())))
  server = undefined
})

/** A port nothing listens on: bound once to learn a free number, then let go. */
async function closedPort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as { port: number }
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

/** Something that accepts the connection and never says a word — a wedged broker, or the wrong port. */
async function silentPort(): Promise<number> {
  server = createServer((socket) => {
    sockets.push(socket)
  })
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
  return (server.address() as { port: number }).port
}

const senderAt = (port: number) =>
  rabbitmqEventSender({
    host: '127.0.0.1',
    port,
    user: 'profile',
    password: 'profile',
    vhost: '/',
    connectTimeoutMs: BUDGET_MS,
    confirmTimeoutMs: BUDGET_MS,
  })

/** How long the send took to reject, and that it did. */
async function rejection(send: Promise<void>): Promise<number> {
  const started = Date.now()
  await expect(send).rejects.toThrow()
  return Date.now() - started
}

describe('the RabbitMQ sender, with no broker to talk to', () => {
  it('rejects within its budget when nothing listens at the broker’s address', async () => {
    const sender = senderAt(await closedPort())
    expect(await rejection(sender.send(event))).toBeLessThan(2_000)
    await sender.close()
  })

  it('rejects within its budget when something accepts the connection but never speaks AMQP', async () => {
    const sender = senderAt(await silentPort())
    expect(await rejection(sender.send(event))).toBeLessThan(2_000)
    await sender.close()
  })

  it('raises no unhandled error either way — the process carries on', async () => {
    const unhandled: unknown[] = []
    const record = (error: unknown): void => {
      unhandled.push(error)
    }
    process.on('uncaughtException', record)
    process.on('unhandledRejection', record)
    try {
      for (const port of [await closedPort(), await silentPort()]) {
        const sender = senderAt(port)
        await sender.send(event).catch(() => undefined)
        await sender.send(event).catch(() => undefined)
        await sender.close()
      }
      await new Promise((resolve) => setTimeout(resolve, 2 * BUDGET_MS))
    } finally {
      process.off('uncaughtException', record)
      process.off('unhandledRejection', record)
    }
    expect(unhandled).toEqual([])
  })
})
