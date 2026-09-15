import { describe, expect, it } from 'vitest'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import { DAYS_OF_WEEK, PreferredRunTime, TIMES_OF_DAY } from '../../../src/domain/preferred-run-time.ts'

describe('PreferredRunTime — §4: a day plus a time of day', () => {
  it('accepts every declared pair', () => {
    for (const day of DAYS_OF_WEEK) {
      for (const time of TIMES_OF_DAY) {
        expect(new PreferredRunTime(day, time).dayOfWeek).toBe(day)
      }
    }
  })

  it.each(['monday', 'MON', ''])('rejects %p as a day', (day) => {
    expect(() => new PreferredRunTime(day, 'evening')).toThrow(InvalidProfileFieldError)
  })

  it.each(['dawn', 'Evening', ''])('rejects %p as a time of day', (time) => {
    expect(() => new PreferredRunTime('mon', time)).toThrow(InvalidProfileFieldError)
  })

  it('ranks by day first, then by time of day', () => {
    const monEvening = new PreferredRunTime('mon', 'evening')
    const tueEarly = new PreferredRunTime('tue', 'early_morning')
    const monEarly = new PreferredRunTime('mon', 'early_morning')
    expect(monEarly.rank).toBeLessThan(monEvening.rank)
    expect(monEvening.rank).toBeLessThan(tueEarly.rank)
  })

  it('is compared by value — both halves must match', () => {
    const base = new PreferredRunTime('sat', 'morning')
    expect(base.equals(new PreferredRunTime('sat', 'morning'))).toBe(true)
    expect(base.equals(new PreferredRunTime('sun', 'morning'))).toBe(false)
    expect(base.equals(new PreferredRunTime('sat', 'evening'))).toBe(false)
  })
})
