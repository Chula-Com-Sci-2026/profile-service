import type { Area } from './area.ts'
import { ensure } from './errors.ts'
import { isExperience, type Experience } from './experience.ts'
import { isGender, type Gender } from './gender.ts'
import type { PaceRange } from './pace-range.ts'
import { PreferredRunTime } from './preferred-run-time.ts'
import type { UsualDistance } from './usual-distance.ts'

/** Everything a profile is made of — domain.md §3. An unset scalar is absent; an unset set is empty. */
export type ProfileFields = {
  userId: string
  displayName: string
  bio?: string
  avatarRef?: string
  birthYear?: number
  gender?: Gender
  area: Area
  paceRange?: PaceRange
  usualDistance?: UsualDistance
  experience?: Experience
  preferredRunTimes: readonly PreferredRunTime[]
  gear: readonly string[]
}

/**
 * A partial edit. An absent key leaves the field alone; `null` clears it.
 * `displayName` and `area` cannot be cleared — a profile cannot exist without them.
 * A set is replaced by sending a new array, never by sending null.
 */
export type ProfileChanges = {
  displayName?: string
  bio?: string | null
  avatarRef?: string | null
  birthYear?: number | null
  gender?: Gender | null
  area?: Area
  paceRange?: PaceRange | null
  usualDistance?: UsualDistance | null
  experience?: Experience | null
  preferredRunTimes?: readonly PreferredRunTime[]
  gear?: readonly string[]
}

/** Trim, then treat a value that is now empty as never given. Keeps "absent" the only unset state. */
function trimmed(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const text = value.trim()
  return text.length > 0 ? text : undefined
}

/**
 * Unique members, in declared order — a set, not a list.
 * Returns `readonly` rather than casting the freeze away: the field is frozen at runtime,
 * so a caller reaching for `.sort()` or `.push()` should fail at compile time, not in production.
 */
function asSet<T extends { rank: number; equals(other: T): boolean }>(members: readonly T[]): readonly T[] {
  const unique: T[] = []
  for (const member of members) {
    if (!unique.some((seen) => seen.equals(member))) unique.push(member)
  }
  return Object.freeze(unique.sort((a, b) => a.rank - b.rank))
}

/**
 * Characters as JSON Schema counts them — Unicode code points, not UTF-16 units.
 * `'🏃'.length` is 2; openapi.yaml's `maxLength` counts it as 1, and the contract wins.
 */
function characters(text: string): number {
  return [...text].length
}

/**
 * Gear — §4. Each item trimmed and measured; an item equal to an earlier one once trimmed is the
 * same item, so it collapses into the first. The runner's order is kept: gear has no declared
 * order to sort by. The count is checked after collapsing — it limits items, not keystrokes.
 */
function asGear(items: readonly string[]): readonly string[] {
  const unique: string[] = []
  for (const raw of items) {
    const item = raw.trim()
    ensure(characters(item) >= 1, 'gear', 'must not hold an empty item')
    ensure(characters(item) <= 50, 'gear', 'must hold items of 50 characters or fewer')
    if (!unique.includes(item)) unique.push(item)
  }
  ensure(unique.length <= 10, 'gear', 'must hold 10 items or fewer')
  return Object.freeze(unique)
}

/** The aggregate root — domain.md §3. One per runner, loaded and saved as one unit, immutable. */
export class Profile {
  readonly userId: string
  readonly displayName: string
  readonly area: Area
  readonly preferredRunTimes: readonly PreferredRunTime[]
  readonly gear: readonly string[]

  // `declare` so TypeScript emits no field. A plain `readonly bio?: string` would define the
  // key with value undefined on every instance, and §3 says an unset scalar is *absent*.
  declare readonly bio?: string
  declare readonly avatarRef?: string
  declare readonly birthYear?: number
  declare readonly gender?: Gender
  declare readonly paceRange?: PaceRange
  declare readonly usualDistance?: UsualDistance
  declare readonly experience?: Experience

  constructor(fields: ProfileFields) {
    const userId = fields.userId.trim()
    ensure(characters(userId) > 0, 'userId', 'must not be empty')
    ensure(characters(userId) <= 64, 'userId', 'must be 64 characters or fewer')

    const displayName = fields.displayName.trim()
    ensure(characters(displayName) >= 1, 'displayName', 'must not be empty')
    ensure(characters(displayName) <= 50, 'displayName', 'must be 50 characters or fewer')

    const bio = trimmed(fields.bio)
    if (bio !== undefined) ensure(characters(bio) <= 500, 'bio', 'must be 500 characters or fewer')

    const avatarRef = trimmed(fields.avatarRef)
    if (avatarRef !== undefined) ensure(characters(avatarRef) <= 128, 'avatarRef', 'must be 128 characters or fewer')

    if (fields.birthYear !== undefined) {
      const thisYear = new Date().getFullYear()
      ensure(Number.isInteger(fields.birthYear), 'birthYear', 'must be a whole number')
      ensure(fields.birthYear >= 1900, 'birthYear', 'must not be earlier than 1900')
      ensure(fields.birthYear <= thisYear, 'birthYear', `must not be later than ${thisYear}`)
    }

    // Value objects validate themselves; the unions cannot, so the root checks them.
    if (fields.gender !== undefined) ensure(isGender(fields.gender), 'gender', 'is not a known value')
    if (fields.experience !== undefined) ensure(isExperience(fields.experience), 'experience', 'is not a known value')

    this.userId = userId
    this.displayName = displayName
    if (bio !== undefined) this.bio = bio
    if (avatarRef !== undefined) this.avatarRef = avatarRef
    if (fields.birthYear !== undefined) this.birthYear = fields.birthYear
    if (fields.gender !== undefined) this.gender = fields.gender
    this.area = fields.area
    if (fields.paceRange !== undefined) this.paceRange = fields.paceRange
    if (fields.usualDistance !== undefined) this.usualDistance = fields.usualDistance
    if (fields.experience !== undefined) this.experience = fields.experience
    this.preferredRunTimes = asSet(fields.preferredRunTimes)
    this.gear = asGear(fields.gear)

    Object.freeze(this)
  }

  /** Apply changes, returning a new Profile. `userId` never changes. */
  update(changes: ProfileChanges): Profile {
    const settle = <T>(change: T | null | undefined, current: T | undefined): T | undefined => {
      if (change === null) return undefined
      if (change !== undefined) return change
      return current
    }

    const bio = settle(changes.bio, this.bio)
    const avatarRef = settle(changes.avatarRef, this.avatarRef)
    const birthYear = settle(changes.birthYear, this.birthYear)
    const gender = settle(changes.gender, this.gender)
    const paceRange = settle(changes.paceRange, this.paceRange)
    const usualDistance = settle(changes.usualDistance, this.usualDistance)
    const experience = settle(changes.experience, this.experience)

    return new Profile({
      userId: this.userId,
      displayName: changes.displayName ?? this.displayName,
      area: changes.area ?? this.area,
      preferredRunTimes: changes.preferredRunTimes ?? this.preferredRunTimes,
      gear: changes.gear ?? this.gear,
      ...(bio !== undefined && { bio }),
      ...(avatarRef !== undefined && { avatarRef }),
      ...(birthYear !== undefined && { birthYear }),
      ...(gender !== undefined && { gender }),
      ...(paceRange !== undefined && { paceRange }),
      ...(usualDistance !== undefined && { usualDistance }),
      ...(experience !== undefined && { experience }),
    })
  }
}
