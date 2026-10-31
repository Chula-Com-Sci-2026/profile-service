import type { Profile } from '../../domain/profile.ts'
import type { PublicCard } from '../../domain/public-card.ts'

/** A photo's public address, from its key. The composition root builds it from configuration. */
export type PhotoUrl = (photoRef: string) => string

/**
 * The owner's view — `Profile` in openapi.yaml: every field, the exact point, its cell, the photo
 * and the hidden set. Every key is always written; an unset field is `null`.
 */
export function ownerView(profile: Profile, photoUrl: PhotoUrl): Record<string, unknown> {
  const cell = profile.areaCell()
  return {
    id: profile.id,
    name: profile.name,
    bio: profile.bio,
    paceMin: profile.paceMin,
    paceMax: profile.paceMax,
    experience: profile.experience,
    area: profile.area,
    latitude: profile.latitude,
    longitude: profile.longitude,
    areaCell: { latitude: cell.latitude, longitude: cell.longitude },
    availability: profile.availability,
    usualDistance: profile.usualDistance,
    gear: profile.gear === null ? null : [...profile.gear],
    photoRef: profile.photoRef,
    photoUrl: profile.photoRef === null ? null : photoUrl(profile.photoRef),
    hiddenFields: [...profile.hiddenFields],
  }
}

/**
 * A public card as JSON — `PublicCard` in openapi.yaml. This file picks no fields for it: which
 * fields others may see is the domain's rule, applied once in `profile.publicCard()`. A hidden or
 * unset field arrives here as `null` and leaves as `null`.
 */
export function cardView(card: PublicCard, photoUrl: PhotoUrl): Record<string, unknown> {
  return {
    id: card.id,
    name: card.name,
    area: card.area,
    areaCell: { latitude: card.areaCell.latitude, longitude: card.areaCell.longitude },
    photoUrl: card.photoRef === null ? null : photoUrl(card.photoRef),
    bio: card.bio,
    paceMin: card.paceMin,
    paceMax: card.paceMax,
    experience: card.experience,
    availability: card.availability,
    usualDistance: card.usualDistance,
    gear: card.gear === null ? null : [...card.gear],
  }
}
