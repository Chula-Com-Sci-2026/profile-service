/**
 * A driven port: declared by the layer that needs it, implemented in `infrastructure/`.
 *
 * `ports/` is the one place `infrastructure/` may import a type from — the lint zone allows
 * exactly this directory and nothing else under `application/`. Anything that is not a contract
 * for an adapter to implement does not belong here.
 *
 * Where a runner's photo lives — object storage owned by this service (domain.md §1).
 *
 * The port is here rather than in `domain/`: unlike `ProfileRepository`, the domain never
 * resolves a photo key. `photoRef` is a string with a §4 rule and nothing more, which is the
 * evidence the boundary was drawn in the right place — storing images is not a domain concept.
 *
 * A key is a runner's only if this service minted it for them — `photos/{id}/{uuid}`, exactly.
 * `holds` and `remove` say no to any other key without asking storage: one that merely starts with
 * the runner's folder is not proof, since a dot segment can climb out of it.
 */
export type PhotoUpload = {
  /** Short-lived. The client PUTs the image here; this service never handles the bytes. */
  uploadUrl: string
  /** The key that upload will occupy — the value to attach afterwards. */
  photoRef: string
  expiresInSeconds: number
}

export type PhotoStorage = {
  /**
   * Signs an upload link for a fresh key `photos/{id}/{uuid}`, once storage has answered — signing
   * is local, so without asking first a dead store would surface as a failed upload in the browser.
   * Rejects when storage does not answer.
   */
  createUpload: (id: string) => Promise<PhotoUpload>
  /**
   * Whether `photoRef` is an object uploaded for this runner. False for any key this service did
   * not mint for them, without asking. Rejects when storage cannot say.
   */
  holds: (id: string, photoRef: string) => Promise<boolean>
  /**
   * Removes one object, by a key a profile used to hold — and only a key minted for this runner. Best
   * effort: storage and the database cannot commit together, and an orphaned image beats a profile
   * that would not accept a change.
   */
  remove: (id: string, photoRef: string) => Promise<void>
}
