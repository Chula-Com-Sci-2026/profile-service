/**
 * Errors that belong to the edge rather than the model.
 *
 * Authentication and ownership are access policy, not domain: domain.md says nothing about
 * who may act, and `openapi.yaml` carries it as `bearerAuth` plus the 401 and 403 responses.
 * So these live here, and `domain/` stays unaware that callers exist.
 */

export class UnauthorizedError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'ForbiddenError'
  }
}
