import { z } from 'zod'

/**
 * Shape only — the rules live in the domain.
 *
 * These say "this is a string", "this is a number", "there is no such field". They do not say
 * "1 to 50 characters" or "one of male, female, non_binary": those are §4's. Both kinds of
 * problem answer 422; the split is about where each check lives, so every rule has one home —
 * and it is why every malformed field is named at once, while a domain rule reports the first
 * it finds broken.
 */
const runTime = z.strictObject({
  dayOfWeek: z.string(),
  timeOfDay: z.string(),
})

/** A point on the map: two numbers and nothing else. Whether they are *on* the map is §4's. */
const point = z.strictObject({
  latitude: z.number(),
  longitude: z.number(),
})

/**
 * `uniqueItems: true` in openapi.yaml. Without this the domain quietly deduplicates and the
 * client gets a 201 describing a set it did not send — the server rewriting the request rather
 * than rejecting it. Uniqueness is shape, so it is checked here.
 */
const noRepeats =
  <T>(identify: (item: T) => string) =>
  (items: T[]): boolean =>
    new Set(items.map(identify)).size === items.length

/** A pace range: two numbers and nothing else. Which is faster, and whether both are in range, is §4's. */
const paceRange = z.strictObject({
  fastest: z.number(),
  slowest: z.number(),
})

/** Exact repeats are shape; items equal only once trimmed are the domain's to collapse. */
const gear = z.array(z.string()).refine(noRepeats((item: string) => item), 'must not repeat an item')

/** `uniqueItems: true` for the hidden set too; which names may be hidden is §4's. */
const hiddenFields = z.array(z.string()).refine(noRepeats((field: string) => field), 'must not repeat a field')

type RunTimeItem = z.infer<typeof runTime>

const runTimes = z
  .array(runTime)
  .refine(
    noRepeats((time: RunTimeItem) => `${time.dayOfWeek}/${time.timeOfDay}`),
    'must not repeat a day and time',
  )

/** `ProfileWrite` in openapi.yaml — no `userId` in the body; it is the path parameter. */
export const profileWrite = z.strictObject({
  displayName: z.string(),
  birthYear: z.number().optional(),
  bio: z.string().optional(),
  avatarRef: z.string().optional(),
  gender: z.string().optional(),
  area: point,
  paceRange: paceRange.optional(),
  usualDistance: z.number().optional(),
  experience: z.string().optional(),
  preferredRunTimes: runTimes.optional(),
  gear: gear.optional(),
  hiddenFields: hiddenFields.optional(),
})

/**
 * `ProfilePatch` in openapi.yaml. A patch body is *not* the resource shape: seven fields accept
 * null to clear, `displayName` and `area` do not — a profile cannot exist without them — and a
 * set is replaced by sending a new array, never by sending null. An area and a pace range are
 * each replaced whole, so every member is required here too.
 */
export const profilePatch = z.strictObject({
  displayName: z.string().optional(),
  birthYear: z.number().nullable().optional(),
  bio: z.string().nullable().optional(),
  avatarRef: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  area: point.optional(),
  paceRange: paceRange.nullable().optional(),
  usualDistance: z.number().nullable().optional(),
  experience: z.string().nullable().optional(),
  preferredRunTimes: runTimes.optional(),
  gear: gear.optional(),
  hiddenFields: hiddenFields.optional(),
})

export type ProfileWriteBody = z.infer<typeof profileWrite>
export type ProfilePatchBody = z.infer<typeof profilePatch>
