import { z } from 'zod'

/**
 * Shape only — the rules live in the domain.
 *
 * These say "this is a string", "this is a number", "there is no such field". They do not say
 * "1 to 50 characters" or "one of male, female, non_binary": those are §4's, and breaking one
 * is a 422 where a malformed body is a 400. Keeping the split here is what makes the two
 * status codes mean different things.
 */
const runTime = z.strictObject({
  dayOfWeek: z.string(),
  timeOfDay: z.string(),
})

/** `ProfileWrite` in openapi.yaml — no `userId` in the body; it is the path parameter. */
export const profileWrite = z.strictObject({
  displayName: z.string(),
  birthYear: z.number(),
  bio: z.string().optional(),
  avatarRef: z.string().optional(),
  gender: z.string().optional(),
  area: z.string().optional(),
  pace: z.number().optional(),
  volume: z.number().optional(),
  experience: z.string().optional(),
  preferredDistances: z.array(z.string()).optional(),
  preferredRunTimes: z.array(runTime).optional(),
})

/**
 * `ProfilePatch` in openapi.yaml. A patch body is *not* the resource shape: seven fields accept
 * null to clear, `displayName` and `birthYear` do not — a profile cannot exist without them —
 * and a set is replaced by sending a new array, never by sending null.
 */
export const profilePatch = z.strictObject({
  displayName: z.string().optional(),
  birthYear: z.number().optional(),
  bio: z.string().nullable().optional(),
  avatarRef: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  area: z.string().nullable().optional(),
  pace: z.number().nullable().optional(),
  volume: z.number().nullable().optional(),
  experience: z.string().nullable().optional(),
  preferredDistances: z.array(z.string()).optional(),
  preferredRunTimes: z.array(runTime).optional(),
})

export type ProfileWriteBody = z.infer<typeof profileWrite>
export type ProfilePatchBody = z.infer<typeof profilePatch>
