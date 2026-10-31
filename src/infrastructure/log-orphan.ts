/** The one call a logger must answer here — pino's `error` fits it. */
export type ErrorLog = { error: (fields: object, message: string) => void }

/**
 * The log line for a photo object storage could not remove. Storage and the database cannot
 * commit together, so an orphan is logged and tolerated rather than retried into a hung request.
 * The correlation id goes at the top level, like every other line of the request (NFR-7.4).
 */
export function logOrphan(log: ErrorLog, currentCorrelationId: () => string | undefined, message: string) {
  return (id: string, error: unknown): void => {
    log.error({ err: error, id, correlationId: currentCorrelationId() }, message)
  }
}
