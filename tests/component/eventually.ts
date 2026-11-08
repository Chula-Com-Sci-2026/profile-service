import { setTimeout as pause } from 'node:timers/promises'

/** How long to keep asking, and how often. */
export type Deadline = { timeoutMs?: number; intervalMs?: number }

/**
 * The suite's only way to wait. Something outside the test process — a container starting, an
 * event crossing the broker, a server draining — happens when it happens, so the test asks again
 * until it has, and gives up at a deadline with a sentence saying what it was waiting for. It
 * never sleeps for a fixed time and hopes.
 *
 * `attempt` answers `undefined`, or throws, for "not yet"; the last error is kept for the message.
 */
export async function eventually<T>(
  what: string,
  attempt: () => Promise<T | undefined>,
  { timeoutMs = 30_000, intervalMs = 200 }: Deadline = {},
): Promise<T> {
  const giveUpAt = Date.now() + timeoutMs
  let lastError: unknown
  for (;;) {
    try {
      const value = await attempt()
      if (value !== undefined) return value
    } catch (error) {
      lastError = error
    }
    if (Date.now() >= giveUpAt) {
      const because = lastError instanceof Error ? ` (last error: ${lastError.message})` : ''
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}${because}`)
    }
    await pause(intervalMs)
  }
}
