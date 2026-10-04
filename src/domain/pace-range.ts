import { ensure } from './errors.ts'
import { Pace } from './pace.ts'

/**
 * The fastest and slowest a runner usually runs — domain.md §4. Each end is a `Pace`, so the
 * 150–900 rule keeps one home; this class adds only that the fastest is not slower than the
 * slowest. A runner with one steady pace gives both ends the same value.
 */
export class PaceRange {
  readonly fastest: Pace
  readonly slowest: Pace

  constructor(fastest: number, slowest: number) {
    this.fastest = new Pace(fastest)
    this.slowest = new Pace(slowest)
    ensure(fastest <= slowest, 'paceRange', 'must not have a fastest pace slower than its slowest')
    Object.freeze(this)
  }

  equals(other: PaceRange): boolean {
    return this.fastest.equals(other.fastest) && this.slowest.equals(other.slowest)
  }
}
