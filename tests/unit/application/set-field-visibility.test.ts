import { describe, expect, it } from 'vitest'
import { setFieldVisibility } from '../../../src/application/set-field-visibility.ts'
import { InvalidProfileFieldError, ProfileNotFoundError } from '../../../src/domain/errors.ts'
import type { HiddenField } from '../../../src/domain/hidden-field.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { RecordingProfileEvents, publishing } from './profile-events-double.ts'
import { aProfile, RAY } from './profiles.ts'

describe('setFieldVisibility', () => {
  it('replaces the hidden set and stores it', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile({ hiddenFields: ['bio'] }))

    const changed = await setFieldVisibility(repository, publishing())(RAY, ['gear', 'pace'])

    expect(changed.hiddenFields).toEqual(['pace', 'gear'])
    expect((await repository.findById(RAY))?.hiddenFields).toEqual(['pace', 'gear'])
    expect(changed.bio).toBe('Evening runs, Lumphini.')
  })

  it('raises the domain error when there is no profile, publishing nothing', async () => {
    const events = new RecordingProfileEvents()

    await expect(setFieldVisibility(new InMemoryProfileRepository(), publishing(events))(RAY, ['bio'])).rejects.toThrow(
      ProfileNotFoundError,
    )
    expect(events.published).toEqual([])
  })

  it('refuses a field that cannot be hidden, storing nothing', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())

    await expect(setFieldVisibility(repository, publishing())(RAY, ['name' as HiddenField])).rejects.toThrow(
      InvalidProfileFieldError,
    )
    expect((await repository.findById(RAY))?.hiddenFields).toEqual([])
  })

  it('publishes the changed profile, after the write', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())
    const events = new RecordingProfileEvents()

    const changed = await setFieldVisibility(repository, publishing(events))(RAY, ['bio'])

    expect(events.published).toEqual([{ type: 'updated', profile: changed }])
  })

  it('keeps the change when delivery fails, and reports it', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())
    const events = new RecordingProfileEvents()
    events.failWith = new Error('Buddy Discovery is down')
    const undelivered: string[] = []

    await setFieldVisibility(repository, { events, onUndelivered: (id) => undelivered.push(id) })(RAY, ['bio'])

    expect((await repository.findById(RAY))?.hiddenFields).toEqual(['bio'])
    expect(undelivered).toEqual([RAY])
  })
})
