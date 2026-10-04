import { ensure } from './errors.ts'

/**
 * How fast, as time per distance — domain.md §4: integer seconds per kilometre, 150–900.
 * Not a profile field on its own: it is each end of a `PaceRange`, so its errors name `paceRange`.
 */
export class Pace {
  readonly secondsPerKilometre: number

  constructor(secondsPerKilometre: number) {
    ensure(Number.isInteger(secondsPerKilometre), 'paceRange', 'must be a whole number of seconds per kilometre')
    ensure(secondsPerKilometre >= 150, 'paceRange', 'must be at least 150 seconds per kilometre')
    ensure(secondsPerKilometre <= 900, 'paceRange', 'must be at most 900 seconds per kilometre')
    this.secondsPerKilometre = secondsPerKilometre
    Object.freeze(this)
  }

  equals(other: Pace): boolean {
    return this.secondsPerKilometre === other.secondsPerKilometre
  }
}
