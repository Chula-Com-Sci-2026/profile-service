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
  readonly id: string

  constructor(id: string) {
    super(`no profile for ${id}`)
    this.name = 'ProfileNotFoundError'
    this.id = id
  }
}

/** One profile per runner — domain.md §5. Raised by a write, never by a read. */
export class ProfileAlreadyExistsError extends Error {
  readonly id: string

  constructor(id: string) {
    super(`a profile already exists for ${id}`)
    this.name = 'ProfileAlreadyExistsError'
    this.id = id
  }
}

/**
 * A profile's revision rises by one with every change — domain.md §5. Raised by a write made from a
 * revision that is no longer the stored one: another change was saved first, or the profile is gone.
 * Never by a read. The change can be made again on what is there now.
 */
export class ConcurrentChangeError extends Error {
  readonly id: string

  constructor(id: string) {
    super(`a change to the profile for ${id} was saved first`)
    this.name = 'ConcurrentChangeError'
    this.id = id
  }
}

/** Throws InvalidProfileFieldError unless the rule holds. */
export function ensure(held: boolean, field: string, rule: string): void {
  if (!held) throw new InvalidProfileFieldError(field, rule)
}
