/** How a runner describes their gender — domain.md §4. */
export const GENDERS = ['male', 'female', 'non_binary'] as const

export type Gender = (typeof GENDERS)[number]

export function isGender(value: unknown): value is Gender {
  return typeof value === 'string' && (GENDERS as readonly string[]).includes(value)
}
