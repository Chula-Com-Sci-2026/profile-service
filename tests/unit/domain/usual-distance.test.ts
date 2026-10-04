import { describe, expect, it } from 'vitest'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import { UsualDistance } from '../../../src/domain/usual-distance.ts'

describe('UsualDistance — §4: integer metres, 1–50 000', () => {
  it.each([1, 5_000, 50_000])('accepts %i', (metres) => {
    expect(new UsualDistance(metres).metres).toBe(metres)
  })

  it.each([0, -1, 50_001])('rejects %i as out of range', (metres) => {
    expect(() => new UsualDistance(metres)).toThrow(InvalidProfileFieldError)
  })

  it.each([5_000.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %p as not a whole number', (metres) => {
    expect(() => new UsualDistance(metres)).toThrow(InvalidProfileFieldError)
  })

  it('names the field it rejected', () => {
    expect(() => new UsualDistance(0)).toThrow(expect.objectContaining({ field: 'usualDistance' }))
  })

  it('is compared by value, not identity', () => {
    expect(new UsualDistance(5_000).equals(new UsualDistance(5_000))).toBe(true)
    expect(new UsualDistance(5_000).equals(new UsualDistance(5_001))).toBe(false)
  })

  it('is immutable', () => {
    const distance = new UsualDistance(5_000)
    expect(() => {
      ;(distance as { metres: number }).metres = 1
    }).toThrow(TypeError)
  })
})
