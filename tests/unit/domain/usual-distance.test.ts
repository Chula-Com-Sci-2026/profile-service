import { describe, expect, it } from 'vitest'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import { toUsualDistance, USUAL_DISTANCES } from '../../../src/domain/usual-distance.ts'

describe('UsualDistance — §4: exactly one of three bands', () => {
  it('is the frontend form’s three labels, the middle one with an en dash', () => {
    expect(USUAL_DISTANCES).toEqual(['Under 5 km', '5–10 km', 'Over 10 km'])
  })

  it.each(['Under 5 km', '5–10 km', 'Over 10 km'])('accepts %p', (label) => {
    expect(toUsualDistance(label)).toBe(label)
  })

  it.each(['5-10 km', '5–10km', 'under 5 km', ''])('refuses %p', (label) => {
    expect(() => toUsualDistance(label)).toThrow(InvalidProfileFieldError)
  })

  it('names the three in its refusal, so a hyphen for the en dash can be put right', () => {
    expect(() => toUsualDistance('5-10 km')).toThrow('Under 5 km, 5–10 km, Over 10 km')
    expect(() => toUsualDistance('5-10 km')).toThrow(expect.objectContaining({ field: 'usualDistance' }))
  })
})
