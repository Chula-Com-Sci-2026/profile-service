import { ensure } from './errors.ts'

/** How far a runner typically runs in a week — domain.md §4: integer metres per week, 0–500 000. */
export class Volume {
  readonly metresPerWeek: number

  constructor(metresPerWeek: number) {
    ensure(Number.isInteger(metresPerWeek), 'volume', 'must be a whole number of metres per week')
    ensure(metresPerWeek >= 0, 'volume', 'must not be negative')
    ensure(metresPerWeek <= 500_000, 'volume', 'must be at most 500000 metres per week')
    this.metresPerWeek = metresPerWeek
    Object.freeze(this)
  }

  equals(other: Volume): boolean {
    return this.metresPerWeek === other.metresPerWeek
  }
}
