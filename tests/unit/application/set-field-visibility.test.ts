import { beforeEach, describe, expect, it } from 'vitest'
import { setFieldVisibility } from '../../../src/application/set-field-visibility.ts'
import { InvalidProfileFieldError, ProfileNotFoundError } from '../../../src/domain/errors.ts'
import type { HiddenField } from '../../../src/domain/hidden-field.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { InMemoryUnitOfWork } from './in-memory-unit-of-work.ts'
import { aProfile, RAY } from './profiles.ts'

let repository: InMemoryProfileRepository
let unitOfWork: InMemoryUnitOfWork

beforeEach(() => {
  repository = new InMemoryProfileRepository()
  unitOfWork = new InMemoryUnitOfWork(repository)
})

describe('setFieldVisibility', () => {
  it('replaces the hidden set and stores it', async () => {
    repository.given(aProfile({ hiddenFields: ['bio'] }))

    const changed = await setFieldVisibility(unitOfWork)(RAY, ['gear', 'pace'])

    expect(changed.hiddenFields).toEqual(['pace', 'gear'])
    expect((await repository.findById(RAY))?.hiddenFields).toEqual(['pace', 'gear'])
    expect(changed.bio).toBe('Evening runs, Lumphini.')
  })

  it('raises its revision, and publishes it in the same unit of work', async () => {
    repository.given(aProfile({ revision: 3 }))

    const changed = await setFieldVisibility(unitOfWork)(RAY, ['bio'])

    expect(changed.revision).toBe(4)
    expect(unitOfWork.published).toEqual([changed])
    expect(unitOfWork.runs).toBe(1)
  })

  it('raises the domain error when there is no profile, publishing nothing', async () => {
    await expect(setFieldVisibility(unitOfWork)(RAY, ['bio'])).rejects.toThrow(ProfileNotFoundError)
    expect(unitOfWork.published).toEqual([])
  })

  it('raises ProfileNotFoundError when the profile vanished between the read and the write', async () => {
    repository.given(aProfile())
    repository.interfere(() => repository.remove(RAY))

    await expect(setFieldVisibility(unitOfWork)(RAY, ['bio'])).rejects.toThrow(ProfileNotFoundError)
    expect([unitOfWork.runs, unitOfWork.published]).toEqual([2, []])
  })

  it('refuses a field that cannot be hidden, storing nothing', async () => {
    repository.given(aProfile())

    await expect(setFieldVisibility(unitOfWork)(RAY, ['name' as HiddenField])).rejects.toThrow(InvalidProfileFieldError)
    expect((await repository.findById(RAY))?.hiddenFields).toEqual([])
    expect(unitOfWork.published).toEqual([])
  })
})
