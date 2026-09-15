/** The public place a runner usually runs — domain.md §4. */
export const AREAS = ['lumphini', 'benchakitti', 'chatuchak'] as const

export type Area = (typeof AREAS)[number]

export function isArea(value: unknown): value is Area {
  return typeof value === 'string' && (AREAS as readonly string[]).includes(value)
}
