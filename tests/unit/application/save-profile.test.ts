import { beforeEach, describe, expect, it } from 'vitest'
import { saveProfile } from '../../../src/application/save-profile.ts'
import { ConcurrentChangeError, InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import { Profile } from '../../../src/domain/profile.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { InMemoryUnitOfWork } from './in-memory-unit-of-work.ts'
import { aProfile, contentFor, RAY } from './profiles.ts'

const PHOTO = `photos/${RAY}/0b5f3c1e-7d2a-4e9b-8f61-2c4d6e8a0b1c`

let repository: InMemoryProfileRepository
let unitOfWork: InMemoryUnitOfWork

beforeEach(() => {
  repository = new InMemoryProfileRepository()
  unitOfWork = new InMemoryUnitOfWork(repository)
})

describe('saveProfile — creating or replacing', () => {
  it('creates the profile at revision 1, and writes its event in the same unit of work', async () => {
    const saved = await saveProfile(unitOfWork)(RAY, contentFor())

    expect(saved.id).toBe(RAY)
    expect(saved.revision).toBe(1)
    expect(saved.hiddenFields).toEqual([])
    // toEqual, not toBe: the Drizzle repository rebuilds the Profile through toDomain.
    expect(await repository.findById(RAY)).toEqual(saved)
    expect(unitOfWork.published).toEqual([saved])
    expect(unitOfWork.runs).toBe(1)
  })

  it('replaces it on a later save, one revision higher, keeping what a save never touches', async () => {
    repository.given(aProfile({ hiddenFields: ['bio'], photoRef: PHOTO }))

    const saved = await saveProfile(unitOfWork)(RAY, contentFor({ name: 'Ray A.', bio: null }))

    expect(saved).toMatchObject({ name: 'Ray A.', bio: null, hiddenFields: ['bio'], photoRef: PHOTO, revision: 2 })
    expect(await repository.findById(RAY)).toEqual(saved)
    expect(repository.size).toBe(1)
    expect(unitOfWork.published).toEqual([saved])
  })

  it('refuses content that breaks a §4 rule, storing and publishing nothing, and does not retry it', async () => {
    await expect(saveProfile(unitOfWork)(RAY, contentFor({ name: '  ' }))).rejects.toThrow(InvalidProfileFieldError)
    expect([repository.size, unitOfWork.published, unitOfWork.runs]).toEqual([0, [], 1])
  })
})

describe('saveProfile — when another change gets in first (domain.md §5)', () => {
  it('answers a double-submitted first save by replacing what the other one created', async () => {
    // Both read "no profile"; the other one inserts first, and this insert meets the primary key.
    repository.interfere(() => repository.given(Profile.create(RAY, contentFor({ name: 'Other tab' }))))

    const saved = await saveProfile(unitOfWork)(RAY, contentFor({ name: 'Ray' }))

    expect(saved).toMatchObject({ name: 'Ray', revision: 2 })
    expect((await repository.findById(RAY))?.name).toBe('Ray')
    expect(unitOfWork.runs).toBe(2)
    expect(unitOfWork.published).toEqual([saved])
  })

  it('makes its change again on the newer profile when another change was saved first', async () => {
    repository.given(aProfile({ revision: 1 }))
    repository.interfere(() => repository.given(aProfile({ revision: 2, hiddenFields: ['bio'] })))

    const saved = await saveProfile(unitOfWork)(RAY, contentFor({ name: 'Ray A.' }))

    expect(saved).toMatchObject({ name: 'Ray A.', hiddenFields: ['bio'], revision: 3 })
    expect(await repository.findById(RAY)).toEqual(saved)
    expect(unitOfWork.published).toEqual([saved])
  })

  it('treats a profile that vanished between the read and the write as a first save', async () => {
    // Review Focus 4: a 200 as a first save — never the 404 its contract does not document.
    repository.given(aProfile({ revision: 4 }))
    repository.interfere(() => repository.remove(RAY))

    const saved = await saveProfile(unitOfWork)(RAY, contentFor())

    expect(saved.revision).toBe(1)
    expect((await repository.findById(RAY))?.revision).toBe(1)
    expect(unitOfWork.published).toEqual([saved])
  })

  it('gives up after three attempts, raising the conflict — the edge answers it with a logged 500', async () => {
    repository.given(aProfile({ revision: 1 }))
    let revision = 1
    repository.interfere(() => repository.given(aProfile({ revision: (revision += 1) })), 3)

    await expect(saveProfile(unitOfWork)(RAY, contentFor())).rejects.toThrow(ConcurrentChangeError)
    expect([unitOfWork.runs, unitOfWork.published]).toEqual([3, []])
  })
})
