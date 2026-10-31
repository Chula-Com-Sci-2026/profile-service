import type { AreaCell } from './area-cell.ts'
import type { Experience } from './experience.ts'
import type { UsualDistance } from './usual-distance.ts'

/**
 * A profile as other runners see it — domain.md §4 "Public card". Built only by
 * `Profile.publicCard()`, the one place field visibility is applied.
 *
 * Every key is always here: a field that is hidden or unset is `null`. `id`, `name`, `area` and the
 * cell never are; the photo is `null` when there is none. The point and the hidden set are never
 * here. The photo travels as its key — its public address is the serialiser's to work out.
 */
export type PublicCard = Readonly<{
  id: string
  name: string
  area: string
  areaCell: AreaCell
  photoRef: string | null
  bio: string | null
  paceMin: number | null
  paceMax: number | null
  experience: Experience | null
  availability: string | null
  usualDistance: UsualDistance | null
  gear: readonly string[] | null
}>
