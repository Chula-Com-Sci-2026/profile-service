import { beforeEach, describe, expect, it } from 'vitest'
import { type RunnerSearch, searchRunners } from '../../../src/application/search-runners.ts'
import { ProfileNotFoundError } from '../../../src/domain/errors.ts'
import type { ProfileFields } from '../../../src/domain/profile.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { aProfile, RAY } from './profiles.ts'

/**
 * The caller is Ray as `aProfile()` makes him: 13.7308, 100.5418, so cell (13.73, 100.54); pace
 * 6–6.5; Intermediate; "Tue & Thu evenings". Everyone else is Ray's content under another id, with
 * whatever a test changes.
 */
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const F = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

/** Every filter left out. */
const none: RunnerSearch = { radiusKm: null, experience: null, overlappingPace: false, availability: null }

let repository: InMemoryProfileRepository

beforeEach(() => {
  repository = new InMemoryProfileRepository()
  repository.given(aProfile())
})

const given = (id: string, overrides: Partial<ProfileFields> = {}): void => repository.given(aProfile({ id, ...overrides }))

const search = (filters: Partial<RunnerSearch> = {}) => searchRunners(repository)(RAY, { ...none, ...filters })

/** The answer as [id, distanceKm] pairs — what most tests care about. */
const found = async (filters: Partial<RunnerSearch> = {}): Promise<[string, number][]> =>
  (await search(filters)).map((result) => [result.card.id, result.distanceKm])

const ids = async (filters: Partial<RunnerSearch> = {}): Promise<string[]> => (await found(filters)).map(([id]) => id)

describe('searchRunners — temporary, until Buddy Discovery’s own search is live', () => {
  it('raises ProfileNotFoundError naming the caller when the caller has no profile', async () => {
    const nobody = '99999999-9999-4999-8999-999999999999'
    await expect(searchRunners(repository)(nobody, none)).rejects.toThrow(ProfileNotFoundError)
    await expect(searchRunners(repository)(nobody, none)).rejects.toMatchObject({ id: nobody })
  })

  it('answers every other runner’s public card, never the caller’s own — even in the same cell', async () => {
    given(A)
    const results = await search()

    expect(results.map((result) => [result.card.id, result.distanceKm])).toEqual([[A, 0]])
    expect('latitude' in results[0]!.card).toBe(false)
    expect('hiddenFields' in results[0]!.card).toBe(false)
  })

  it('measures between area cells, never exact points (NFR-4.1)', async () => {
    // 22 m apart, either side of a cell edge: A shares Ray's cell, B is the next one north.
    given(A, { latitude: 13.7349 })
    given(B, { latitude: 13.7351 })

    expect(await found()).toEqual([
      [A, 0],
      [B, 1.1],
    ])
    // However small the radius, a search learns the cell and nothing finer.
    expect(await ids({ radiusKm: 0.1 })).toEqual([A])
  })

  it('rounds distanceKm to one decimal', async () => {
    given(A, { latitude: 13.73, longitude: 100.56 }) // 2.16035… km
    expect(await found()).toEqual([[A, 2.2]])
  })

  it('keeps a runner shown at 10.0 when no radius is given, and leaves out one at 11.1', async () => {
    given(A, { latitude: 13.82, longitude: 100.54 }) // 10.0075… km
    given(B, { latitude: 13.83, longitude: 100.54 }) // 11.119… km
    expect(await found()).toEqual([[A, 10]])
  })

  it('keeps a runner whose distanceKm equals the radius, and leaves out one past it', async () => {
    given(A, { latitude: 13.73, longitude: 100.56 }) // 2.2
    given(B, { latitude: 13.73, longitude: 100.58 }) // 4.3

    expect(await ids({ radiusKm: 2.2 })).toEqual([A])
    expect(await ids({ radiusKm: 2.1 })).toEqual([])
    expect(await ids({ radiusKm: 4.3 })).toEqual([A, B])
  })

  it('orders by the distanceKm it shows, then by id', async () => {
    given(B, { latitude: 13.73, longitude: 100.56 }) // 2.1604 km, shown as 2.2
    given(A, { latitude: 13.75, longitude: 100.54 }) // 2.2239 km, shown as 2.2
    given(C, { latitude: 13.73, longitude: 100.58 }) // 4.3
    given(F) // Ray's cell, 0

    // A is a little further than B, but both show 2.2, so the id decides.
    expect(await found()).toEqual([
      [F, 0],
      [A, 2.2],
      [B, 2.2],
      [C, 4.3],
    ])
  })

  it('keeps only the experience asked for, and every level when none is', async () => {
    given(A, { experience: 'Beginner' })
    given(B, { experience: 'Advanced' })

    expect(await ids({ experience: 'Advanced' })).toEqual([B])
    expect(await ids()).toEqual([A, B])
  })

  it('keeps runners whose pace range overlaps the caller’s, ends included', async () => {
    const second = 1 / 60
    given(A, { paceMin: 6.5, paceMax: 7 }) // touches the caller's slower end
    given(B, { paceMin: 5.5, paceMax: 6 }) // touches the caller's faster end
    given(C, { paceMin: 6.1, paceMax: 6.2 }) // inside it
    given(D, { paceMin: 5, paceMax: 8 }) // around it
    given(E, { paceMin: 6.5 + second, paceMax: 7 }) // a second too slow
    given(F, { paceMin: 5, paceMax: 6 - second }) // a second too fast

    expect(await ids({ overlappingPace: true })).toEqual([A, B, C, D])
    expect(await ids()).toEqual([A, B, C, D, E, F])
  })

  it('overlaps the caller’s saved range even when the caller hides it', async () => {
    repository.given(aProfile({ hiddenFields: ['pace'] }))
    given(A, { paceMin: 6.5, paceMax: 7 })
    given(B, { paceMin: 8, paceMax: 9 })

    expect(await ids({ overlappingPace: true })).toEqual([A])
  })

  it('keeps runners whose availability contains the text, ignoring case', async () => {
    given(A, { availability: 'Tue & Thu evenings' })
    given(B, { availability: 'Sat mornings' })

    expect(await ids({ availability: 'tue' })).toEqual([A])
    expect(await ids({ availability: 'TUE & thu' })).toEqual([A])
  })

  it.each([
    ['experience', { experience: 'Advanced' }, { experience: 'Advanced' }],
    ['pace', { overlappingPace: true }, { paceMin: 6, paceMax: 6.5 }],
    ['availability', { availability: 'tue' }, { availability: 'Tue & Thu evenings' }],
  ] as const)('a hidden %s fails an active filter on it, and passes when that filter is off', async (field, filter, matching) => {
    given(A, { ...matching, hiddenFields: [field] })

    expect(await ids(filter)).toEqual([])
    const [result] = await search()
    expect(result?.card.id).toBe(A)
    const card = result?.card as unknown as Record<string, unknown>
    for (const key of field === 'pace' ? ['paceMin', 'paceMax'] : [field]) expect(card[key]).toBeNull()
  })

  it('keeps only runners every given filter keeps', async () => {
    given(A, { experience: 'Advanced', paceMin: 6, paceMax: 6.5, availability: 'Tue mornings' })
    given(B, { experience: 'Beginner', paceMin: 6, paceMax: 6.5, availability: 'Tue mornings' })
    given(C, { experience: 'Advanced', paceMin: 9, paceMax: 9.5, availability: 'Tue mornings' })
    given(D, { experience: 'Advanced', paceMin: 6, paceMax: 6.5, availability: 'Sat mornings' })
    given(E, { experience: 'Advanced', paceMin: 6, paceMax: 6.5, availability: 'Tue mornings', latitude: 13.83 })

    expect(await ids({ experience: 'Advanced', overlappingPace: true, availability: 'tue' })).toEqual([A])
  })

  it('answers [] when nobody else is within the radius', async () => {
    given(A, { latitude: 13.83 })
    expect(await search()).toEqual([])
  })
})
