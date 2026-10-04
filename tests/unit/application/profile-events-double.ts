import type { ProfileEvents } from '../../../src/application/ports/profile-events.ts'
import type { Publishing } from '../../../src/application/publishing.ts'
import type { Profile } from '../../../src/domain/profile.ts'

export type Published = { type: 'updated'; profile: Profile } | { type: 'deleted'; userId: string }

/** Records what was published, and can be told to fail the way a dead subscriber would. */
export class RecordingProfileEvents implements ProfileEvents {
  readonly published: Published[] = []
  failWith: Error | undefined

  async updated(profile: Profile): Promise<void> {
    this.published.push({ type: 'updated', profile })
    if (this.failWith !== undefined) throw this.failWith
  }

  async deleted(userId: string): Promise<void> {
    this.published.push({ type: 'deleted', userId })
    if (this.failWith !== undefined) throw this.failWith
  }
}

/** Publishing that records events and reports nothing — for tests about something else. */
export function publishing(events: ProfileEvents = new RecordingProfileEvents()): Publishing {
  return { events, onUndelivered: () => {} }
}
