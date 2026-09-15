import { InvalidProfileFieldError } from './errors.ts'

/** The public place a runner usually runs — domain.md §4. */
export const AREAS = ['lumphini', 'benchakitti', 'chatuchak'] as const

export type Area = (typeof AREAS)[number]

export function isArea(value: unknown): value is Area {
  return typeof value === 'string' && (AREAS as readonly string[]).includes(value)
}

/** Narrows a value arriving from a row or a request body. §4's list is the rule, and it lives here. */
export function toArea(value: string): Area {
  if (!isArea(value)) throw new InvalidProfileFieldError('area', `must be one of ${AREAS.join(', ')}`)
  return value
}
