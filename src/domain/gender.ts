import { InvalidProfileFieldError } from './errors.ts'

/** How a runner describes their gender — domain.md §4. */
export const GENDERS = ['male', 'female', 'non_binary'] as const

export type Gender = (typeof GENDERS)[number]

export function isGender(value: unknown): value is Gender {
  return typeof value === 'string' && (GENDERS as readonly string[]).includes(value)
}

/** Narrows a value arriving from a row or a request body. §4's list is the rule, and it lives here. */
export function toGender(value: string): Gender {
  if (!isGender(value)) throw new InvalidProfileFieldError('gender', `must be one of ${GENDERS.join(', ')}`)
  return value
}
