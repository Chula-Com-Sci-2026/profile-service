/**
 * A driven port: declared by the layer that needs it, implemented in `infrastructure/`.
 *
 * `ports/` is the one place `infrastructure/` may import a type from — the lint zone allows
 * exactly this directory and nothing else under `application/`. Anything that is not a contract
 * for an adapter to implement does not belong here.
 *
 * Where a runner's profile image lives — object storage owned by this service (domain.md §1).
 *
 * The port is here rather than in `domain/`: unlike `ProfileRepository`, the domain never
 * resolves an avatar key. `avatarRef` is a string with a §4 rule and nothing more, which is the
 * evidence the boundary was drawn in the right place — storing images is not a domain concept.
 */
export type AvatarUpload = {
  /** Short-lived. The client PUTs the image here; this service never handles the bytes. */
  uploadUrl: string
  /** The key that upload will occupy — the value to send back as `avatarRef`. */
  avatarRef: string
  expiresInSeconds: number
}

export type AvatarStorage = {
  authoriseUpload: (userId: string) => Promise<AvatarUpload>
  /**
   * Removes one object, by the key a profile used to hold. Best effort, like removeAll: an
   * orphaned image is a better outcome than a profile that would not accept a change.
   */
  remove: (avatarRef: string) => Promise<void>
  /**
   * Removes every avatar a runner has. Best effort by nature: storage and the database cannot
   * commit together, and losing the profile is not the outcome to prefer.
   */
  removeAll: (userId: string) => Promise<void>
}
