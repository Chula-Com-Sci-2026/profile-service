/** How new or experienced a runner is — domain.md §4. */
export const EXPERIENCES = ['beginner', 'intermediate', 'advanced'] as const

export type Experience = (typeof EXPERIENCES)[number]

export function isExperience(value: unknown): value is Experience {
  return typeof value === 'string' && (EXPERIENCES as readonly string[]).includes(value)
}
