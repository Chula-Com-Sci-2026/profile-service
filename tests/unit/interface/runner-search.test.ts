import { describe, expect, it } from 'vitest'
import type { RunnerSearch } from '../../../src/application/search-runners.ts'
import { Profile } from '../../../src/domain/profile.ts'
import { cardView } from '../../../src/interface/http/profile-view.ts'
import { runnerSearchQuery, searchResultView, toRunnerSearch } from '../../../src/interface/http/runner-search.ts'

/**
 * The temporary search's edge: which query values mean "not given", and which cannot be read.
 * Discovery's request is proto3, so an unset filter may arrive as `0` or `""`; the frontend sends
 * `pace=Any`, `experience=All` and `verifiedOnly`.
 */
const read = (query: Record<string, string>): RunnerSearch => toRunnerSearch(runnerSearchQuery.parse(query))

const nothing: RunnerSearch = { radiusKm: null, experience: null, overlappingPace: false, availability: null }

/** The parameter a refusal names. */
function refused(query: Record<string, string>): unknown {
  const result = runnerSearchQuery.safeParse(query)
  expect(result.success, JSON.stringify(query)).toBe(false)
  return result.error?.issues[0]?.path
}

describe('reading a runner search from the query', () => {
  it('reads nothing given as no filter at all', () => {
    expect(read({})).toEqual(nothing)
  })

  it('reads proto3’s unset forms as not given', () => {
    expect(read({ radiusKm: '0', experience: '', pace: '', availability: '' })).toEqual(nothing)
  })

  it.each(['', '0', '-5', '-0'])('reads radiusKm %j as not given', (radiusKm) => {
    expect(read({ radiusKm }).radiusKm).toBeNull()
  })

  it('reads radiusKm as kilometres', () => {
    expect(read({ radiusKm: ' 2.5 ' }).radiusKm).toBe(2.5)
  })

  it.each(['abc', 'NaN', 'Infinity', '5km'])('refuses radiusKm %j, naming radiusKm', (radiusKm) => {
    expect(refused({ radiusKm })).toEqual(['radiusKm'])
  })

  it.each(['', 'All'])('reads experience %j as every level', (experience) => {
    expect(read({ experience }).experience).toBeNull()
  })

  it.each(['Beginner', 'Intermediate', 'Advanced'])('reads experience %s as that level', (experience) => {
    expect(read({ experience }).experience).toBe(experience)
  })

  it.each(['all', 'Expert', ' Advanced'])('refuses experience %j, naming experience', (experience) => {
    expect(refused({ experience })).toEqual(['experience'])
  })

  it.each(['', 'Any'])('reads pace %j as no pace filter', (pace) => {
    expect(read({ pace }).overlappingPace).toBe(false)
  })

  it.each(['6:00–6:30', 'any', '5'])('reads pace %j as overlap with the caller’s range — the value itself is not read', (pace) => {
    expect(read({ pace }).overlappingPace).toBe(true)
  })

  it('trims availability, and reads blank as no filter', () => {
    expect(read({ availability: '  Tue ' }).availability).toBe('Tue')
    expect(read({ availability: '   ' }).availability).toBeNull()
  })

  it('ignores parameters it does not know, such as verifiedOnly', () => {
    expect(read({ verifiedOnly: 'true' })).toEqual(nothing)
  })
})

describe('writing a search result', () => {
  it('writes the card’s JSON plus distanceKm', () => {
    const card = Profile.create('11111111-1111-4111-8111-111111111111', {
      name: 'Ray',
      paceMin: 6,
      paceMax: 6.5,
      experience: 'Intermediate',
      area: 'Lumphini area',
      latitude: 13.7308,
      longitude: 100.5418,
      availability: 'Tue & Thu evenings',
    })
      .attachPhoto('photos/11111111-1111-4111-8111-111111111111/abc')
      .publicCard()
    const photoUrl = (photoRef: string): string => `http://storage.test/${photoRef}`

    expect(searchResultView({ card, distanceKm: 2.2 }, photoUrl)).toEqual({ ...cardView(card, photoUrl), distanceKm: 2.2 })
  })
})
