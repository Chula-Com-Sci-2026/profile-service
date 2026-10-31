import type { Profile } from '../../domain/profile.ts'

/**
 * A driven port: declared by the layer that needs it, implemented in `infrastructure/`.
 *
 * Tells other services what happened to a profile — domain.md §1: Profile is Buddy Discovery's
 * supplier. ADR-0019's "one publisher interface": a REST sender now, a broker later, behind the
 * same port.
 *
 * It takes the domain `Profile`, not a payload. What leaves this service — the public snapshot,
 * the area only as its cell — is the adapter's published language, not this layer's business.
 * The call may reject when delivery fails; the use cases catch that, because by then the
 * change is already saved.
 */
export type ProfileEvents = {
  /** After a profile is created or changed. */
  updated: (profile: Profile) => Promise<void>
}
