import { ensure } from './errors.ts'

/** How fast a runner runs, as time per distance — domain.md §4: integer seconds per kilometre, 150–900. */
export class Pace {
  readonly secondsPerKilometre: number

  constructor(secondsPerKilometre: number) {
    ensure(Number.isInteger(secondsPerKilometre), 'pace', 'must be a whole number of seconds per kilometre')
    ensure(secondsPerKilometre >= 150, 'pace', 'must be at least 150 seconds per kilometre')
    ensure(secondsPerKilometre <= 900, 'pace', 'must be at most 900 seconds per kilometre')
    this.secondsPerKilometre = secondsPerKilometre
    Object.freeze(this)
  }

  equals(other: Pace): boolean {
    return this.secondsPerKilometre === other.secondsPerKilometre
  }
}
