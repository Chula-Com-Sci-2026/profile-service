import { randomUUID } from 'node:crypto'
import { isId } from '../domain/id.ts'

/**
 * A photo's key — `photos/{id}/{uuid}`: the runner's id, then a fresh uuid per upload, so
 * replacing a photo cannot collide with a cached copy of the old one. The one home of that shape:
 * the key is minted and checked here, so the two cannot drift apart.
 */
export function newPhotoKey(id: string): string {
  return `photos/${id}/${randomUUID()}`
}

/**
 * Whether `photoRef` is a key this service minted for this runner — exactly `photos/{id}/{uuid}`,
 * the uuid in lowercase as `randomUUID()` writes it, and nothing more.
 *
 * Starting with `photos/{id}/` is not proof. The key comes from a request body and the SDK sends
 * it as it is, so `photos/{id}/../{other id}/{uuid}` would reach another runner's photo on a store
 * that resolves dot segments — and a store that refuses them would answer with a fault, not "no
 * such photo". Only the exact shape is a key of theirs.
 */
export function isPhotoKeyOf(id: string, photoRef: string): boolean {
  const folder = `photos/${id}/`
  // The uuid has the form of an id (domain.md §4): a UUID in lowercase.
  return isId(id) && photoRef.startsWith(folder) && isId(photoRef.slice(folder.length))
}
