import { describe, expect, it, vi } from 'vitest'
import type { EventSender } from '../../../src/infrastructure/event-sender.ts'
import type { Outbox, OutboxMessage } from '../../../src/infrastructure/outbox.ts'
import { outboxRelay, type RelayLog } from '../../../src/infrastructure/outbox-relay.ts'
import type { ProfileUpdatedEvent } from '../../../src/infrastructure/profile-published-language.ts'

const RAY = '11111111-1111-4111-8111-111111111111'
const CORRELATION = 'abcdef01-2345-4678-89ab-cdef01234567'

/** An event as the outbox holds it; only its names and its runner matter to the relay. */
function eventFor(sequence: number): ProfileUpdatedEvent {
  return {
    eventId: `00000000-0000-4000-8000-00000000000${sequence}`,
    eventType: 'ProfileUpdated',
    version: 1,
    occurredAt: '2026-11-01T00:00:00.000Z',
    correlationId: CORRELATION,
    payload: { id: RAY, name: 'Ray Attajak', area: 'Lumphini area', revision: sequence },
  }
}

/** The outbox in an array. `failReads` makes the next reads reject, as a database down would. */
class MemoryOutbox implements Outbox {
  readonly messages: OutboxMessage[]
  readonly sent = new Set<number>()
  failReads = 0

  constructor(count: number) {
    this.messages = Array.from({ length: count }, (_, i) => ({ sequence: i + 1, event: eventFor(i + 1) }))
  }

  add(): void {
    const sequence = this.messages.length + 1
    this.messages.push({ sequence, event: eventFor(sequence) })
  }

  oldestUnsent = async (): Promise<OutboxMessage | null> => {
    if (this.failReads > 0) {
      this.failReads -= 1
      throw new Error('the database is down')
    }
    return this.messages.find((message) => !this.sent.has(message.sequence)) ?? null
  }

  markSent = async (sequence: number): Promise<void> => {
    this.sent.add(sequence)
  }

  get unsent(): number[] {
    return this.messages.map((message) => message.sequence).filter((sequence) => !this.sent.has(sequence))
  }
}

/** A sender that does what the test says: fail while `failing` is set, and wait while `gate` is. */
class ScriptedSender implements EventSender {
  readonly attempted: string[] = []
  readonly delivered: string[] = []
  /** What the outbox had marked sent at the moment each send began. */
  readonly markedWhenSent: number[][] = []
  failing: Error | undefined
  gate: Promise<void> | undefined
  closed = false
  readonly #outbox: MemoryOutbox

  constructor(outbox: MemoryOutbox) {
    this.#outbox = outbox
  }

  send = async (event: ProfileUpdatedEvent): Promise<void> => {
    this.attempted.push(event.eventId)
    this.markedWhenSent.push([...this.#outbox.sent])
    if (this.gate !== undefined) await this.gate
    if (this.failing !== undefined) throw this.failing
    this.delivered.push(event.eventId)
  }

  close = async (): Promise<void> => {
    this.closed = true
  }
}

type Line = { level: 'info' | 'warn'; fields: Record<string, unknown>; message: string }

function recordingLog(): RelayLog & { lines: Line[] } {
  const lines: Line[] = []
  return {
    lines,
    info: (fields, message) => lines.push({ level: 'info', fields: fields as Record<string, unknown>, message }),
    warn: (fields, message) => lines.push({ level: 'warn', fields: fields as Record<string, unknown>, message }),
  }
}

function given(count: number) {
  const outbox = new MemoryOutbox(count)
  const sender = new ScriptedSender(outbox)
  const log = recordingLog()
  const relay = outboxRelay({ outbox, sender, log })
  return { outbox, sender, log, relay }
}

const warnings = (log: { lines: Line[] }): Line[] => log.lines.filter((line) => line.level === 'warn')

describe('the outbox relay', () => {
  it('sends unsent rows oldest first, one at a time, marking each sent only after the sender resolves', async () => {
    const { outbox, sender, relay } = given(3)

    await relay.runOnce()

    expect(sender.delivered).toEqual([1, 2, 3].map((n) => eventFor(n).eventId))
    expect(sender.markedWhenSent).toEqual([[], [1], [1, 2]])
    expect(outbox.unsent).toEqual([])
  })

  it('stops at the first failure, leaving it and every later row unsent', async () => {
    const { outbox, sender, relay } = given(3)
    sender.send = async (event) => {
      sender.attempted.push(event.eventId)
      if (event.eventId === eventFor(2).eventId) throw new Error('no queue is bound for ProfileUpdated')
      sender.delivered.push(event.eventId)
    }

    await relay.runOnce()

    expect(sender.attempted).toEqual([eventFor(1).eventId, eventFor(2).eventId])
    expect(outbox.unsent).toEqual([2, 3])
  })

  it('logs an outage once, however many ticks it lasts, and says when delivery resumes', async () => {
    // Review Focus 1: no queue bound yet is an outage that lasts until Discovery binds one.
    const { outbox, sender, log, relay } = given(1)
    sender.failing = new Error('no queue is bound for ProfileUpdated')

    for (let tick = 0; tick < 5; tick += 1) await relay.runOnce()
    expect(warnings(log)).toHaveLength(1)
    expect(warnings(log)[0]?.message).toBe('profile events cannot be delivered; they wait in the outbox')

    sender.failing = undefined
    await relay.runOnce()
    expect(log.lines.map((line) => line.message)).toEqual([
      'profile events cannot be delivered; they wait in the outbox',
      'profile events are being delivered again',
      'profile event sent',
    ])
    expect(outbox.unsent).toEqual([])
  })

  it('names eventId, eventType, id and correlationId in its log lines, never the payload', async () => {
    const { sender, log, relay } = given(2)
    sender.send = async (event) => {
      if (event.eventId === eventFor(2).eventId) throw new Error('the broker is unreachable')
    }

    await relay.runOnce()

    const names = (n: number) => ({ eventId: eventFor(n).eventId, eventType: 'ProfileUpdated', id: RAY, correlationId: CORRELATION })
    expect(log.lines.map((line) => [line.level, line.message])).toEqual([
      ['info', 'profile event sent'],
      ['warn', 'profile events cannot be delivered; they wait in the outbox'],
    ])
    expect(log.lines[0]?.fields).toEqual(names(1))
    expect(log.lines[1]?.fields).toMatchObject(names(2))
    for (const line of log.lines) {
      const keys = Object.keys(line.fields).filter((key) => key !== 'err')
      expect(keys.sort()).toEqual(['correlationId', 'eventId', 'eventType', 'id'])
    }
    expect(JSON.stringify(log.lines)).not.toContain('Lumphini')
  })

  it('treats a database failure like any other: logged once, tried again on the next tick', async () => {
    const { outbox, sender, log, relay } = given(1)
    outbox.failReads = 2

    await relay.runOnce()
    await relay.runOnce()
    expect(warnings(log)).toHaveLength(1)
    expect(sender.attempted).toEqual([])

    await relay.runOnce()
    expect(outbox.unsent).toEqual([])
  })

  it('stop() waits for the send in flight, then closes the sender, and sends nothing after', async () => {
    const { outbox, sender, relay } = given(2)
    let release: () => void = () => {}
    sender.gate = new Promise((resolve) => {
      release = resolve
    })

    const ticking = relay.runOnce()
    await vi.waitFor(() => expect(sender.attempted).toHaveLength(1))
    let stopped = false
    const stopping = relay.stop().then(() => {
      stopped = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect([stopped, sender.closed]).toEqual([false, false])

    release()
    await stopping
    await ticking
    expect(sender.closed).toBe(true)
    expect(sender.delivered).toEqual([eventFor(1).eventId])
    expect(outbox.unsent).toEqual([2])

    await relay.runOnce()
    expect(sender.attempted).toHaveLength(1)
  })

  it('treats a malformed row as an outage: logged once, holding the rows behind it, never crashing the ticks', async () => {
    // A row whose envelope has no payload. Building its log line once threw outside the tick's
    // own catch, so the tick rejected unhandled — Node exits on that — and no tick came after it.
    const outbox = new MemoryOutbox(1)
    const malformed = { eventId: 'not-an-envelope', eventType: 'ProfileUpdated' } as unknown as ProfileUpdatedEvent
    outbox.messages.unshift({ sequence: 0, event: malformed })
    let reads = 0
    const read = outbox.oldestUnsent
    outbox.oldestUnsent = () => {
      reads += 1
      return read()
    }
    const sender = new ScriptedSender(outbox)
    const log = recordingLog()
    const relay = outboxRelay({ outbox, sender, log, intervalMs: 10 })
    const unhandled: unknown[] = []
    const record = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', record)

    try {
      relay.start()
      await new Promise((resolve) => setTimeout(resolve, 120))
      await relay.stop()
    } finally {
      process.off('unhandledRejection', record)
    }

    expect(unhandled).toEqual([])
    expect(reads).toBeGreaterThan(2)
    expect(warnings(log)).toHaveLength(1)
    expect(warnings(log)[0]?.fields).toMatchObject({ sequence: 0 })
    expect(sender.attempted).toEqual([])
    expect(outbox.unsent).toEqual([0, 1])
  })

  it('start() ticks every interval until stopped', async () => {
    const outbox = new MemoryOutbox(0)
    const sender = new ScriptedSender(outbox)
    const relay = outboxRelay({ outbox, sender, log: recordingLog(), intervalMs: 10 })

    relay.start()
    outbox.add()
    await vi.waitFor(() => expect(outbox.unsent).toEqual([]), { timeout: 500 })

    await relay.stop()
    outbox.add()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(outbox.unsent).toEqual([2])
  })
})
