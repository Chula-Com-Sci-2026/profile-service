const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A UUID in its usual spelling: 8-4-4-4-12 hex digits, any case, no version check. What the team
 * means by an id — "Use UUID IDs" — and what a token's subject and a correlation id must be.
 */
export function isUuid(text: string): boolean {
  return UUID.test(text)
}
