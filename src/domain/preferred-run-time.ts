import { ensure } from './errors.ts'

/** Which days and times of day a runner prefers to run — domain.md §4. Bangkok local time (UTC+7). */
export const DAYS_OF_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export const TIMES_OF_DAY = ['early_morning', 'morning', 'midday', 'afternoon', 'evening', 'night'] as const

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number]
export type TimeOfDay = (typeof TIMES_OF_DAY)[number]

export function isDayOfWeek(value: unknown): value is DayOfWeek {
  return typeof value === 'string' && (DAYS_OF_WEEK as readonly string[]).includes(value)
}

export function isTimeOfDay(value: unknown): value is TimeOfDay {
  return typeof value === 'string' && (TIMES_OF_DAY as readonly string[]).includes(value)
}

export class PreferredRunTime {
  readonly dayOfWeek: DayOfWeek
  readonly timeOfDay: TimeOfDay

  constructor(dayOfWeek: string, timeOfDay: string) {
    ensure(isDayOfWeek(dayOfWeek), 'preferredRunTimes', `dayOfWeek must be one of ${DAYS_OF_WEEK.join(', ')}`)
    ensure(isTimeOfDay(timeOfDay), 'preferredRunTimes', `timeOfDay must be one of ${TIMES_OF_DAY.join(', ')}`)
    this.dayOfWeek = dayOfWeek as DayOfWeek
    this.timeOfDay = timeOfDay as TimeOfDay
    Object.freeze(this)
  }

  equals(other: PreferredRunTime): boolean {
    return this.dayOfWeek === other.dayOfWeek && this.timeOfDay === other.timeOfDay
  }

  /** Declared order: mon before tue, and within a day early_morning before night. */
  get rank(): number {
    return DAYS_OF_WEEK.indexOf(this.dayOfWeek) * TIMES_OF_DAY.length + TIMES_OF_DAY.indexOf(this.timeOfDay)
  }
}
