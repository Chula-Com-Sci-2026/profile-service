import type { ErrorLog } from './http-profile-events.ts'

/**
 * The log line for an avatar object storage could not remove. Storage and the database cannot
 * commit together, so an orphan is logged and tolerated rather than retried into a hung request.
 * The correlation id goes at the top level, like every other line of the request (NFR-7.4).
 */
export function logOrphan(log: ErrorLog, currentCorrelationId: () => string | undefined, message: string) {
  return (userId: string, error: unknown): void => {
    log.error({ err: error, userId, correlationId: currentCorrelationId() }, message)
  }
}
