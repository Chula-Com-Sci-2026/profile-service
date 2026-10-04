import type { AreaCell } from './area.ts'
import type { Experience } from './experience.ts'
import type { Gender } from './gender.ts'
import type { PaceRange } from './pace-range.ts'
import type { PreferredRunTime } from './preferred-run-time.ts'
import type { UsualDistance } from './usual-distance.ts'

/**
 * A profile as other runners see it — domain.md §4 "Public card". Built only by
 * `Profile.publicCard()`, the one place field visibility is applied. A hidden or unset field is
 * absent; the exact area is never here.
 */
export type PublicCard = Readonly<{
  userId: string
  displayName: string
  areaCell: AreaCell
  avatarRef?: string
  bio?: string
  birthYear?: number
  gender?: Gender
  paceRange?: PaceRange
  usualDistance?: UsualDistance
  experience?: Experience
  preferredRunTimes?: readonly PreferredRunTime[]
  gear?: readonly string[]
}>
