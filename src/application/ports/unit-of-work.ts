import type { ProfileRepository } from '../../domain/profile-repository.ts'
import type { ProfileEvents } from './profile-events.ts'

/**
 * A driven port: declared by the layer that needs it, implemented in `infrastructure/`.
 *
 * What a change to a profile is handed: the repository and the events, both inside one
 * transaction. The write and the event it causes commit together or not at all, so other services
 * never hear of a change that was not saved, and a saved change is never left untold.
 */
export type Transaction = {
  profiles: ProfileRepository
  events: ProfileEvents
}

/**
 * Runs `work` in a transaction of its own and commits when it resolves; when it throws, nothing it
 * wrote is kept. Each call is a fresh transaction — a conflict aborts the one it happens in, so a
 * retry needs another.
 */
export type UnitOfWork = {
  run: <T>(work: (transaction: Transaction) => Promise<T>) => Promise<T>
}
