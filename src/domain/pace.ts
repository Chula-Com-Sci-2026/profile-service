import { ensure } from './errors.ts'

/**
 * A pace — domain.md §4: decimal minutes per kilometre, more than 0 and at most 20 as given, then
 * kept to the nearest second. 6:20 /km is `6.333333333333333`, which a double and JSON carry
 * exactly, so the same value is stored, served and published. Rounding a kept value again changes
 * nothing, so a pace read back from a row passes through unchanged.
 *
 * Not a profile field on its own: `paceMin` and `paceMax` each go through here, and the error names
 * the one that broke.
 */
export function toPace(minutes: number, field: 'paceMin' | 'paceMax'): number {
  // NaN fails both comparisons, and so does an infinity, so the range is the whole check.
  ensure(minutes > 0 && minutes <= 20, field, 'must be more than 0 and at most 20 minutes per kilometre')
  const kept = Math.round(minutes * 60) / 60
  ensure(kept > 0, field, 'must be at least one second per kilometre')
  return kept
}
