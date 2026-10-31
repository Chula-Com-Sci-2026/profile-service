import { beforeEach, describe, expect, it } from 'vitest'
import { republishProfiles } from '../../../src/application/republish-profiles.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { InMemoryUnitOfWork } from './in-memory-unit-of-work.ts'
import { aProfile, RAY } from './profiles.ts'

const BEAM = '44444444-4444-4444-8444-444444444444'

let repository: InMemoryProfileRepository
let unitOfWork: InMemoryUnitOfWork

beforeEach(() => {
  repository = new InMemoryProfileRepository()
  unitOfWork = new InMemoryUnitOfWork(repository)
})

describe('republishProfiles', () => {
  it('writes one ProfileUpdated per stored profile, each under its unchanged revision, in one unit of work', async () => {
    repository.given(aProfile({ revision: 3 }))
    repository.given(aProfile({ id: BEAM, revision: 1 }))

    expect(await republishProfiles(unitOfWork)()).toBe(2)

    expect(unitOfWork.published.map((profile) => [profile.id, profile.revision])).toEqual([
      [RAY, 3],
      [BEAM, 1],
    ])
    expect(unitOfWork.runs).toBe(1)
    expect((await repository.findById(RAY))?.revision).toBe(3)
  })

  it('writes nothing and answers 0 when there is no profile', async () => {
    expect(await republishProfiles(unitOfWork)()).toBe(0)
    expect(unitOfWork.published).toEqual([])
  })
})
