import { toExperience } from '../../domain/experience.ts'
import type { ProfileContent } from '../../domain/profile.ts'
import { toUsualDistance } from '../../domain/usual-distance.ts'
import type { ProfileSaveBody } from './validators.ts'

/**
 * Validated body → domain types. Nothing is renamed: the body's names are the domain's.
 *
 * Zod infers an optional field as `T | undefined`, which `exactOptionalPropertyTypes` refuses to
 * hand to the domain — so a key left out stays left out, rather than arriving as `undefined`. That
 * keeps "left out" and "null" apart, which a save needs: our additions keep when left out and clear
 * with null.
 */
export function toContent(body: ProfileSaveBody): ProfileContent {
  return {
    name: body.name,
    paceMin: body.paceMin,
    paceMax: body.paceMax,
    experience: toExperience(body.experience),
    area: body.area,
    latitude: body.latitude,
    longitude: body.longitude,
    availability: body.availability,
    ...(body.bio !== undefined && { bio: body.bio }),
    ...(body.usualDistance !== undefined && {
      usualDistance: body.usualDistance === null ? null : toUsualDistance(body.usualDistance),
    }),
    ...(body.gear !== undefined && { gear: body.gear }),
  }
}
