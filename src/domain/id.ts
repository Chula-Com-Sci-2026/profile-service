const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * A runner's id — domain.md §4: Identity's id for the runner, a UUID (8-4-4-4-12 hex digits, no
 * version check) in lowercase. Lowercase only, so one runner is one id: whatever a request spells
 * in another case is lowercased at the edge before it gets here.
 */
export function isId(value: string): boolean {
  return ID.test(value)
}
