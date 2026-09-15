/** Domain errors. Never an HTTP status here — the edge decides what these are worth saying. */

/** A field broke one of its rules in domain.md §4. */
export class InvalidProfileFieldError extends Error {
  readonly field: string
  readonly rule: string

  constructor(field: string, rule: string) {
    super(`${field} ${rule}`)
    this.name = 'InvalidProfileFieldError'
    this.field = field
    this.rule = rule
  }
}

/** No profile for that runner. A normal outcome of a query; policy turns it into an error. */
export class ProfileNotFoundError extends Error {
  readonly userId: string

  constructor(userId: string) {
    super(`no profile for ${userId}`)
    this.name = 'ProfileNotFoundError'
    this.userId = userId
  }
}

/** One profile per runner — domain.md §5. Raised by a write, never by a read. */
export class ProfileAlreadyExistsError extends Error {
  readonly userId: string

  constructor(userId: string) {
    super(`a profile already exists for ${userId}`)
    this.name = 'ProfileAlreadyExistsError'
    this.userId = userId
  }
}

/** Throws InvalidProfileFieldError unless the rule holds. */
export function ensure(held: boolean, field: string, rule: string): void {
  if (!held) throw new InvalidProfileFieldError(field, rule)
}
