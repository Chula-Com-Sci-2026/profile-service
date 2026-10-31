/**
 * Errors that belong to the edge rather than the model.
 *
 * Authentication is access policy, not domain: domain.md says nothing about who may act, and
 * `openapi.yaml` carries it as `bearerAuth` plus the 401 responses. So these live here, and
 * `domain/` stays unaware that callers exist.
 */

/** The request body would not parse. Raised at the parse site, never inferred from a type. */
export class MalformedBodyError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'MalformedBodyError'
  }
}

export class UnauthorizedError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'UnauthorizedError'
  }
}
