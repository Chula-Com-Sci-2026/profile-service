import { InvalidProfileFieldError } from './errors.ts'

/**
 * The fields a runner may leave off their public card — domain.md §4, in declared order. `pace`
 * hides `paceMin` and `paceMax` together. `id`, `name`, `area`, the area cell and the photo are not
 * here: they are always shown.
 */
export const HIDEABLE_FIELDS = ['bio', 'pace', 'availability', 'experience', 'usualDistance', 'gear'] as const

export type HiddenField = (typeof HIDEABLE_FIELDS)[number]

export function isHiddenField(value: unknown): value is HiddenField {
  return typeof value === 'string' && (HIDEABLE_FIELDS as readonly string[]).includes(value)
}

/** Narrows a value arriving from a row or a request body. §4's list is the rule, and it lives here. */
export function toHiddenField(value: string): HiddenField {
  if (!isHiddenField(value)) {
    throw new InvalidProfileFieldError('hiddenFields', `must hold only ${HIDEABLE_FIELDS.join(', ')}`)
  }
  return value
}
