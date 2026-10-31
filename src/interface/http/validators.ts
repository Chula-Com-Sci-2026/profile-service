import { z } from 'zod'

/**
 * Shape only — the rules live in the domain.
 *
 * These say "this is a string", "this is a number", "this is required". They do not say "1 to 80
 * characters" or "one of Beginner, Intermediate, Advanced": those are §4's. Both kinds of problem
 * answer 422; the split is about where each check lives, so every rule has one home — and it is
 * why every malformed field is named at once, while a domain rule reports the first it finds broken.
 *
 * `z.object` strips keys it does not know rather than refusing them, as the team's Profile contract
 * does: a client may send back the owner's view as it came, `id` and `areaCell` included.
 */

/**
 * `uniqueItems: true` in openapi.yaml. Without this the domain quietly collapses the repeat and
 * the client gets an answer describing a list it did not send — the server rewriting the request
 * rather than refusing it. Uniqueness is shape, so it is checked here.
 */
const noRepeats =
  <T>(identify: (item: T) => string) =>
  (items: T[]): boolean =>
    new Set(items.map(identify)).size === items.length

/** Exact repeats are shape; items equal only once trimmed are the domain's to collapse. */
const gear = z.array(z.string()).refine(noRepeats((item: string) => item), 'must not repeat an item')

/** `ProfileSave` in openapi.yaml. The runner's answers are required; ours and the bio may be left out or null. */
export const profileSave = z.object({
  name: z.string(),
  bio: z.string().nullable().optional(),
  paceMin: z.number(),
  paceMax: z.number(),
  experience: z.string(),
  area: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  availability: z.string(),
  usualDistance: z.string().nullable().optional(),
  gear: gear.nullable().optional(),
})

export type ProfileSaveBody = z.infer<typeof profileSave>
