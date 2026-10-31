import { InvalidProfileFieldError } from './errors.ts'

/** How new or experienced a runner is — domain.md §4: the label the team frontend shows, in exactly this case. */
export const EXPERIENCES = ['Beginner', 'Intermediate', 'Advanced'] as const

export type Experience = (typeof EXPERIENCES)[number]

export function isExperience(value: unknown): value is Experience {
  return typeof value === 'string' && (EXPERIENCES as readonly string[]).includes(value)
}

/** Narrows a value arriving from a row or a request body. §4's list is the rule, and it lives here. */
export function toExperience(value: string): Experience {
  if (!isExperience(value)) throw new InvalidProfileFieldError('experience', `must be one of ${EXPERIENCES.join(', ')}`)
  return value
}
