import { randomUUID } from 'node:crypto'
import { type Channel, type ChannelModel, connect } from 'amqplib'
import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { saveProfile } from '../../src/application/save-profile.ts'
import type { ProfileContent } from '../../src/domain/profile.ts'
import { drizzleUnitOfWork } from '../../src/infrastructure/drizzle-unit-of-work.ts'
import { drizzleOutbox } from '../../src/infrastructure/outbox.ts'
import { outboxRelay } from '../../src/infrastructure/outbox-relay.ts'
import type { ProfileUpdatedEvent } from '../../src/infrastructure/profile-published-language.ts'
import { EXCHANGE, rabbitmqEventSender } from '../../src/infrastructure/rabbitmq-event-sender.ts'

/** The whole way out: a save writes its event to the outbox, and the relay takes it to a bound queue. */
const broker = inject('rabbitmq')
const QUEUE = 'profile-relay-check'
const NOK = '33333333-3333-4333-8333-333333333333'
const content: ProfileContent = {
  name: 'Nok',
  paceMin: 7,
  paceMax: 8,
  experience: 'Beginner',
  area: 'Lumphini Park',
  latitude: 13.7314,
  longitude: 100.5414,
  availability: 'Sat early mornings',
}
const options = { photoUrl: (photoRef: string) => `http://localhost:9000/profile-service/${photoRef}`, correlationId: () => randomUUID() }

let pool: pg.Pool
let db: NodePgDatabase
let admin: ChannelModel
let channel: Channel

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: inject('databaseUrl') })
  db = drizzle(pool)
  admin = await connect({ hostname: broker.host, port: broker.port, username: broker.admin.user, password: broker.admin.password })
  channel = await admin.createChannel()
})

afterAll(async () => {
  await admin.close()
  await pool.end()
})

beforeEach(async () => {
  await db.execute(sql`TRUNCATE profiles, outbox`)
  await channel.deleteQueue(QUEUE)
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true })
  await channel.assertQueue(QUEUE, { durable: true })
  await channel.bindQueue(QUEUE, EXCHANGE, 'ProfileUpdated')
})

describe('the outbox, as the relay reads it', () => {
  it('hands out the oldest unsent row first, and forgets a row once it is marked sent', async () => {
    const save = saveProfile(drizzleUnitOfWork(db, options))
    await save(NOK, content)
    await save(NOK, { ...content, name: 'Nok R.' })
    const outbox = drizzleOutbox(db)

    const first = await outbox.oldestUnsent()
    expect(first?.event.payload.revision).toBe(1)
    await outbox.markSent(first?.sequence ?? -1)

    const second = await outbox.oldestUnsent()
    expect(second?.event.payload.revision).toBe(2)
    expect(second?.sequence).toBeGreaterThan(first?.sequence ?? Infinity)
    await outbox.markSent(second?.sequence ?? -1)

    expect(await outbox.oldestUnsent()).toBeNull()
  })
})

describe('the relay', () => {
  it('takes saved changes to a queue bound to cra.events, in order, and marks each row sent', async () => {
    const save = saveProfile(drizzleUnitOfWork(db, options))
    await save(NOK, content)
    await save(NOK, { ...content, name: 'Nok R.' })
    const sender = rabbitmqEventSender({ ...broker.profile, host: broker.host, port: broker.port, vhost: '/' })
    const relay = outboxRelay({ outbox: drizzleOutbox(db), sender, log: { info: () => {}, warn: () => {} } })

    await relay.runOnce()
    await relay.stop()

    const revisions: number[] = []
    for (let message = await channel.get(QUEUE, { noAck: true }); message !== false; message = await channel.get(QUEUE, { noAck: true })) {
      revisions.push((JSON.parse(message.content.toString('utf8')) as ProfileUpdatedEvent).payload.revision)
    }
    expect(revisions).toEqual([1, 2])
    const unsent = await db.execute(sql`SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL`)
    expect(unsent.rows[0]).toEqual({ n: 0 })
  })
})
