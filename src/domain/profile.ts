import { AreaCell } from './area-cell.ts'
import { ensure } from './errors.ts'
import { EXPERIENCES, isExperience, type Experience } from './experience.ts'
import { HIDEABLE_FIELDS, isHiddenField, type HiddenField } from './hidden-field.ts'
import { isId } from './id.ts'
import { toPace } from './pace.ts'
import type { PublicCard } from './public-card.ts'
import { isUsualDistance, USUAL_DISTANCES, type UsualDistance } from './usual-distance.ts'

/**
 * Everything a profile is made of — domain.md §3, under the names the wire and the columns use.
 * An unset field is `null`, never absent: the same value a request carries and a row stores.
 */
export type ProfileFields = {
  id: string
  name: string
  bio: string | null
  paceMin: number
  paceMax: number
  experience: Experience
  area: string
  latitude: number
  longitude: number
  availability: string
  usualDistance: UsualDistance | null
  gear: readonly string[] | null
  photoRef: string | null
  hiddenFields: readonly HiddenField[]
}

/**
 * What a save carries — domain.md §3 `saveProfile()`. The runner's answers are required and
 * replace what was there; a `bio` left out is no bio. Our two additions keep when left out:
 * `usualDistance` clears with `null`, `gear` with `null` or `[]`. There is no `id`, hidden set or
 * photo here, so a save cannot change them.
 */
export type ProfileContent = {
  name: string
  bio?: string | null
  paceMin: number
  paceMax: number
  experience: Experience
  area: string
  latitude: number
  longitude: number
  availability: string
  usualDistance?: UsualDistance | null
  gear?: readonly string[] | null
}

/**
 * Characters as JSON Schema counts them — Unicode code points, not UTF-16 units.
 * `'🏃'.length` is 2; openapi.yaml's `maxLength` counts it as 1, and the contract wins.
 */
function characters(text: string): number {
  return [...text].length
}

/** Required text — §4: trimmed, then between 1 and `most` characters. */
function required(value: string, field: string, most: number): string {
  const text = value.trim()
  ensure(characters(text) >= 1, field, 'must not be empty')
  ensure(characters(text) <= most, field, `must be ${most} characters or fewer`)
  return text
}

/** The bio — §4: trimmed, at most 240 characters; blank is no bio, so `null` stays the one unset state. */
function asBio(value: string | null): string | null {
  if (value === null) return null
  const text = value.trim()
  if (text.length === 0) return null
  ensure(characters(text) <= 240, 'bio', 'must be 240 characters or fewer')
  return text
}

/**
 * Gear — §4. Each item trimmed and measured; an item equal to an earlier one once trimmed is the
 * same item, so it collapses into the first. The runner's order is kept: gear has no declared
 * order to sort by. The count is checked after collapsing — it limits items, not keystrokes.
 * No items is no gear: `null`, never `[]`.
 *
 * Returns `readonly` rather than casting the freeze away: the list is frozen at runtime, so a
 * caller reaching for `.push()` should fail at compile time, not in production.
 */
function asGear(items: readonly string[] | null): readonly string[] | null {
  if (items === null) return null
  const unique: string[] = []
  for (const raw of items) {
    const item = raw.trim()
    ensure(characters(item) >= 1, 'gear', 'must not hold an empty item')
    ensure(characters(item) <= 50, 'gear', 'must hold items of 50 characters or fewer')
    if (!unique.includes(item)) unique.push(item)
  }
  ensure(unique.length <= 10, 'gear', 'must hold 10 items or fewer')
  return unique.length === 0 ? null : Object.freeze(unique)
}

/** The aggregate root — domain.md §3. One per runner, loaded and saved as one unit, immutable. */
export class Profile {
  readonly id: string
  readonly name: string
  readonly bio: string | null
  readonly paceMin: number
  readonly paceMax: number
  readonly experience: Experience
  readonly area: string
  readonly latitude: number
  readonly longitude: number
  readonly availability: string
  readonly usualDistance: UsualDistance | null
  readonly gear: readonly string[] | null
  readonly photoRef: string | null
  readonly hiddenFields: readonly HiddenField[]

  /** Enforces every §4 rule, in the order of domain.md's table, and reports the first one broken. */
  constructor(fields: ProfileFields) {
    ensure(isId(fields.id), 'id', 'must be a UUID in lowercase')
    const name = required(fields.name, 'name', 80)
    const bio = asBio(fields.bio)

    const paceMin = toPace(fields.paceMin, 'paceMin')
    const paceMax = toPace(fields.paceMax, 'paceMax')
    // Compared once kept to the second, so two values in the same second are equal, not reversed.
    ensure(paceMin <= paceMax, 'paceMin', 'must not be slower than paceMax — paceMin is the faster end')

    // The unions cannot check themselves, so the root does.
    ensure(isExperience(fields.experience), 'experience', `must be one of ${EXPERIENCES.join(', ')}`)
    const area = required(fields.area, 'area', 100)
    // NaN fails both comparisons, and so does an infinity, so the range is the whole check.
    ensure(fields.latitude >= -90 && fields.latitude <= 90, 'latitude', 'must be between -90 and 90')
    ensure(fields.longitude >= -180 && fields.longitude <= 180, 'longitude', 'must be between -180 and 180')
    const availability = required(fields.availability, 'availability', 120)

    if (fields.usualDistance !== null) {
      ensure(isUsualDistance(fields.usualDistance), 'usualDistance', `must be one of ${USUAL_DISTANCES.join(', ')}`)
    }
    const gear = asGear(fields.gear)
    if (fields.photoRef !== null) ensure(characters(fields.photoRef) <= 128, 'photoRef', 'must be 128 characters or fewer')
    for (const field of fields.hiddenFields) {
      ensure(isHiddenField(field), 'hiddenFields', `must hold only ${HIDEABLE_FIELDS.join(', ')}`)
    }

    this.id = fields.id
    this.name = name
    this.bio = bio
    this.paceMin = paceMin
    this.paceMax = paceMax
    this.experience = fields.experience
    this.area = area
    this.latitude = fields.latitude
    this.longitude = fields.longitude
    this.availability = availability
    this.usualDistance = fields.usualDistance
    this.gear = gear
    this.photoRef = fields.photoRef
    // A set in declared order: filtering the declared list both deduplicates and sorts.
    this.hiddenFields = Object.freeze(HIDEABLE_FIELDS.filter((field) => fields.hiddenFields.includes(field)))

    Object.freeze(this)
  }

  /** The first save — `saveProfile()` on a runner with no profile: nothing hidden, no photo. */
  static create(id: string, content: ProfileContent): Profile {
    return new Profile({
      id,
      ...Profile.#answers(content),
      usualDistance: content.usualDistance ?? null,
      gear: content.gear ?? null,
      photoRef: null,
      hiddenFields: [],
    })
  }

  /**
   * A later save — domain.md §3 `saveProfile()`. The runner's answers replace what was there; our
   * two additions keep when left out. The id, the hidden set and the photo are not the save's to
   * change, so a save can never reveal or detach anything.
   */
  save(content: ProfileContent): Profile {
    return new Profile({
      ...this.#fields(),
      ...Profile.#answers(content),
      ...(content.usualDistance !== undefined && { usualDistance: content.usualDistance }),
      ...(content.gear !== undefined && { gear: content.gear }),
    })
  }

  /**
   * Which fields other runners see — domain.md §3 `setFieldVisibility()`. Replaces the hidden set
   * whole and changes nothing else; §4's rule on which names may be hidden is the constructor's.
   */
  setFieldVisibility(hiddenFields: readonly HiddenField[]): Profile {
    return new Profile({ ...this.#fields(), hiddenFields })
  }

  /**
   * Puts an uploaded photo on the profile — domain.md §3 `attachPhoto()`. §4's rule on the key is
   * the constructor's; whether it is this runner's and was really uploaded is storage's to say, so
   * the use case asks before it gets here.
   */
  attachPhoto(photoRef: string): Profile {
    return new Profile({ ...this.#fields(), photoRef })
  }

  /** Takes the photo off the profile — domain.md §3 `removePhoto()`. */
  removePhoto(): Profile {
    return new Profile({ ...this.#fields(), photoRef: null })
  }

  /** The point as other runners see it — domain.md §4 "Area cells". Worked out, never stored. */
  areaCell(): AreaCell {
    return new AreaCell(this.latitude, this.longitude)
  }

  /**
   * The profile as other runners see it — domain.md §4 "Public card". The only place field
   * visibility is applied: the API and ProfileUpdated both serialise what this returns.
   */
  publicCard(): PublicCard {
    const shown = (field: HiddenField): boolean => !this.hiddenFields.includes(field)
    return Object.freeze({
      id: this.id,
      name: this.name,
      area: this.area,
      areaCell: this.areaCell(),
      photoRef: this.photoRef,
      bio: shown('bio') ? this.bio : null,
      paceMin: shown('pace') ? this.paceMin : null,
      paceMax: shown('pace') ? this.paceMax : null,
      experience: shown('experience') ? this.experience : null,
      availability: shown('availability') ? this.availability : null,
      usualDistance: shown('usualDistance') ? this.usualDistance : null,
      gear: shown('gear') ? this.gear : null,
    })
  }

  /** The runner's answers in a save — replaced whole every time. A bio left out is no bio. */
  static #answers(content: ProfileContent) {
    return {
      name: content.name,
      bio: content.bio ?? null,
      paceMin: content.paceMin,
      paceMax: content.paceMax,
      experience: content.experience,
      area: content.area,
      latitude: content.latitude,
      longitude: content.longitude,
      availability: content.availability,
    }
  }

  /** This profile as the fields it was built from — the starting point of every change. */
  #fields(): ProfileFields {
    return {
      id: this.id,
      name: this.name,
      bio: this.bio,
      paceMin: this.paceMin,
      paceMax: this.paceMax,
      experience: this.experience,
      area: this.area,
      latitude: this.latitude,
      longitude: this.longitude,
      availability: this.availability,
      usualDistance: this.usualDistance,
      gear: this.gear,
      photoRef: this.photoRef,
      hiddenFields: this.hiddenFields,
    }
  }
}
