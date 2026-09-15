import { describe, expect, it } from 'vitest'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import { DISTANCES, PreferredDistance, isDistance } from '../../../src/domain/preferred-distance.ts'

describe('PreferredDistance — §4: 5k · 10k · half_marathon · marathon', () => {
  it.each([...DISTANCES])('accepts %s', (distance) => {
    expect(new PreferredDistance(distance).distance).toBe(distance)
  })

  it.each(['ultra', '5K', 'half marathon', ''])('rejects %p', (distance) => {
    expect(() => new PreferredDistance(distance)).toThrow(InvalidProfileFieldError)
  })

  it('guards a value arriving from outside TypeScript', () => {
    expect(isDistance('marathon')).toBe(true)
    expect(isDistance('ultra')).toBe(false)
    expect(isDistance(42)).toBe(false)
  })

  it('ranks by declared order, so 5k sorts before 10k', () => {
    expect(new PreferredDistance('5k').rank).toBeLessThan(new PreferredDistance('10k').rank)
  })

  it('is compared by value', () => {
    expect(new PreferredDistance('10k').equals(new PreferredDistance('10k'))).toBe(true)
    expect(new PreferredDistance('10k').equals(new PreferredDistance('marathon'))).toBe(false)
  })
})
