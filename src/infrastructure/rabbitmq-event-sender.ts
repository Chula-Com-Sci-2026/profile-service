import { type ChannelModel, type ConfirmChannel, type Message, connect } from 'amqplib'
import type { RabbitMqConfig } from './config.ts'
import type { EventSender } from './event-sender.ts'
import type { ProfileUpdatedEvent } from './profile-published-language.ts'

/** The team's event exchange (`events.md`): topic, durable, routing key = `eventType`. */
export const EXCHANGE = 'cra.events'

/** How long connecting may take, and how long the broker may take to confirm one publish. */
const CONNECT_TIMEOUT_MS = 5_000
const CONFIRM_TIMEOUT_MS = 5_000

export type RabbitMqSenderOptions = RabbitMqConfig & {
  /** Test seams; 5 000 ms each otherwise. */
  connectTimeoutMs?: number
  confirmTimeoutMs?: number
}

/**
 * The broker took the event and had nowhere to put it: no queue is bound for its routing key. Not
 * an outage of the broker — until a consumer binds its queue, every event comes back this way and
 * stays in the outbox (`events.md`: consumers must be provisioned before events can leave it).
 */
export class UnroutableEventError extends Error {
  readonly eventId: string
  readonly eventType: string

  constructor(event: ProfileUpdatedEvent) {
    super(`${event.eventType} ${event.eventId} was returned: no queue is bound to ${EXCHANGE} for ${event.eventType}`)
    this.name = 'UnroutableEventError'
    this.eventId = event.eventId
    this.eventType = event.eventType
  }
}

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)))

/**
 * `ProfileUpdated` to RabbitMQ over a normal AMQP connection, as Profile's own broker user (B11) —
 * `amqplib`, the client the team's Identity uses.
 *
 * It connects only when there is something to send, so an empty outbox never touches the broker
 * and startup never waits for it. Every connect declares `cra.events` (topic, durable) — which is
 * why the user may configure that exchange — and opens a confirm channel. An event counts as sent
 * only once the broker confirmed it and did not hand it back as unroutable: published `mandatory`,
 * an unroutable message comes back before its confirm.
 *
 * A dropped connection is forgotten, never fatal: listeners on `error` and `close` let go of it,
 * so an `error` event can never go unhandled and crash the process, and the next send connects
 * afresh.
 */
export function rabbitmqEventSender(options: RabbitMqSenderOptions): EventSender {
  const connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
  const confirmTimeoutMs = options.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS
  let open: { connection: ChannelModel; channel: ConfirmChannel } | undefined

  /** Lets go of a connection: the next send makes a new one. Closing it is best effort. */
  function drop(connection: ChannelModel): void {
    if (open?.connection === connection) open = undefined
    connection.close().catch(() => undefined)
  }

  async function connected(): Promise<ConfirmChannel> {
    if (open !== undefined) return open.channel

    const connection = await connect(
      {
        protocol: 'amqp',
        hostname: options.host,
        port: options.port,
        username: options.user,
        password: options.password,
        vhost: options.vhost,
      },
      { timeout: connectTimeoutMs },
    )
    // The send that fails says why; these only make sure nothing is left unhandled.
    connection.on('error', () => drop(connection))
    connection.on('close', () => drop(connection))

    try {
      const channel = await connection.createConfirmChannel()
      channel.on('error', () => drop(connection))
      channel.on('close', () => drop(connection))
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true })
      open = { connection, channel }
      return channel
    } catch (error) {
      drop(connection)
      throw error
    }
  }

  return {
    send: async (event) => {
      const channel = await connected()
      const connection = open?.connection

      await new Promise<void>((resolve, reject) => {
        let returned = false
        const onReturn = (message: Message): void => {
          if (message.properties.messageId === event.eventId) returned = true
        }
        const settle = (): void => {
          clearTimeout(timer)
          channel.off('return', onReturn)
        }
        const timer = setTimeout(() => {
          settle()
          if (connection !== undefined) drop(connection)
          reject(new Error(`the broker did not confirm ${event.eventType} ${event.eventId} within ${confirmTimeoutMs} ms`))
        }, confirmTimeoutMs)

        channel.on('return', onReturn)
        try {
          channel.publish(
            EXCHANGE,
            event.eventType,
            Buffer.from(JSON.stringify(event)),
            { mandatory: true, persistent: true, contentType: 'application/json', messageId: event.eventId },
            (error: unknown) => {
              settle()
              if (error !== null && error !== undefined) reject(asError(error))
              else if (returned) reject(new UnroutableEventError(event))
              else resolve()
            },
          )
        } catch (error) {
          // A channel that closed between the connect and the publish throws rather than calls back.
          settle()
          if (connection !== undefined) drop(connection)
          reject(asError(error))
        }
      })
    },

    close: async () => {
      const current = open
      open = undefined
      await current?.connection.close().catch(() => undefined)
    },
  }
}
