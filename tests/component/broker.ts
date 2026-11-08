import { connect } from 'amqplib'
import { getContainerRuntimeClient } from 'testcontainers'
import { inject } from 'vitest'
import { type Deadline, eventually } from './eventually.ts'
import { BROKER_ADMIN } from './stack.ts'

/**
 * The broker as a consumer sees it. Profile publishes `ProfileUpdated` to the `cra.events`
 * exchange with the event type as the routing key (docs/profile-events.schema.json); the test
 * binds a queue of its own there, as Buddy Discovery would, and reads what arrives.
 */
const EXCHANGE = 'cra.events'
const ROUTING_KEY = 'ProfileUpdated'

const { brokerContainerId } = inject('component')

/** The parts of an event the tests match on; the rest is checked against the event schema. */
export type ProfileUpdated = {
  eventId: string
  eventType: string
  payload: { id: string; revision: number } & Record<string, unknown>
} & Record<string, unknown>

export type ProfileUpdatedQueue = {
  /**
   * Takes off the queue, and returns, the first event about this runner — at this revision, when
   * one is given — that has arrived or arrives before the deadline.
   */
  next: (about: { id: string; revision?: number }, deadline?: Deadline) => Promise<ProfileUpdated>
  close: () => Promise<void>
}

/**
 * Where the broker listens on this machine right now. Asked of Docker each time rather than handed
 * over once, because the outage scenario restarts the broker and its host port can change.
 */
async function brokerAddress(): Promise<string> {
  const client = await getContainerRuntimeClient()
  const { NetworkSettings } = await client.container.inspect(client.container.getById(brokerContainerId))
  const port = NetworkSettings.Ports?.['5672/tcp']?.[0]?.HostPort
  if (port === undefined) throw new Error('the broker has no host port for 5672')
  return `amqp://${BROKER_ADMIN.user}:${BROKER_ADMIN.password}@${client.info.containerRuntime.host}:${port}`
}

/**
 * As the broker's admin: declares `cra.events` exactly as Profile does (topic, durable), then an
 * exclusive queue of the test's own bound to it for ProfileUpdated, and keeps what arrives.
 * Exclusive, because RabbitMQ 4 refuses a queue that is neither durable nor exclusive; it goes
 * away with the connection, or with the broker.
 */
export async function listenForProfileUpdated(): Promise<ProfileUpdatedQueue> {
  const connection = await connect(await brokerAddress())
  // A broker that goes away closes this connection. That must not crash the test worker: the
  // scenario waiting on it fails with its own message instead.
  connection.on('error', () => undefined)
  try {
    const channel = await connection.createChannel()
    channel.on('error', () => undefined)
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true })
    const { queue } = await channel.assertQueue('', { exclusive: true })
    await channel.bindQueue(queue, EXCHANGE, ROUTING_KEY)

    const arrived: ProfileUpdated[] = []
    await channel.consume(
      queue,
      (message) => {
        if (message !== null) arrived.push(JSON.parse(message.content.toString()) as ProfileUpdated)
      },
      { noAck: true },
    )

    return {
      next: (about, deadline) => {
        const matches = (event: ProfileUpdated): boolean =>
          event.payload.id === about.id && (about.revision === undefined || event.payload.revision === about.revision)
        const what = `a ProfileUpdated about ${about.id}${about.revision === undefined ? '' : ` at revision ${about.revision}`}`
        return eventually(
          what,
          async () => {
            const at = arrived.findIndex(matches)
            return at === -1 ? undefined : arrived.splice(at, 1)[0]
          },
          deadline,
        )
      },
      close: async () => {
        await connection.close().catch(() => undefined)
      },
    }
  } catch (error) {
    await connection.close().catch(() => undefined)
    throw error
  }
}
