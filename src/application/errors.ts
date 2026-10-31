/**
 * Errors of the use cases themselves — neither a §4 rule (those are the domain's) nor anything about
 * HTTP (the edge decides what these are worth saying).
 */

/**
 * Object storage did not answer an operation that needs it. Only the photo operations ever raise
 * this: nothing else asks storage, so its being down costs photos and nothing more. The adapter's
 * own error is kept as the cause, for the log line.
 */
export class StorageUnavailableError extends Error {
  constructor(cause: unknown) {
    super('object storage did not answer', { cause })
    this.name = 'StorageUnavailableError'
  }
}
