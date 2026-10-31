import { isId } from '../../domain/id.ts'

/**
 * A UUID in its usual spelling, any case: 8-4-4-4-12 hex digits, no version check. What the team
 * means by an id — "Use UUID IDs" — and what a token's subject and a correlation id must be. The
 * format is the domain's (domain.md §4's `id`); the edge accepts it in any case and lowercases
 * what it keeps.
 */
export function isUuid(text: string): boolean {
  return isId(text.toLowerCase())
}
