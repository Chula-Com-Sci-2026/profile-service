import type { Profile } from '../../domain/profile.ts'

/**
 * A driven port: declared by the layer that needs it, implemented in `infrastructure/`.
 *
 * Tells other services what happened to a profile — domain.md §1: Profile is Buddy Discovery's
 * supplier. A use case is handed one inside a unit of work, and `updated()` records the event in
 * that transaction, to be sent once it commits; how and when it is sent is not this layer's
 * business. It rejects only when recording fails, which fails the change with it.
 *
 * It takes the domain `Profile`, not a payload. What leaves this service — the public snapshot,
 * the area only as its cell, the revision — is the adapter's published language.
 */
export type ProfileEvents = {
  /** After a profile is created or changed. */
  updated: (profile: Profile) => Promise<void>
}
