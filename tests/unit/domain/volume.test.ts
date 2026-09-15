import { describe, expect, it } from 'vitest'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import { Volume } from '../../../src/domain/volume.ts'

describe('Volume — §4: integer metres per week, 0–500 000', () => {
  it.each([0, 45_000, 500_000])('accepts %i', (metres) => {
    expect(new Volume(metres).metresPerWeek).toBe(metres)
  })

  it.each([-1, 500_001])('rejects %i as out of range', (metres) => {
    expect(() => new Volume(metres)).toThrow(InvalidProfileFieldError)
  })

  it('rejects a fraction of a metre', () => {
    expect(() => new Volume(1.5)).toThrow(InvalidProfileFieldError)
  })

  it('accepts zero — a runner who does not run this week still has a profile', () => {
    expect(new Volume(0).metresPerWeek).toBe(0)
  })

  it('is compared by value', () => {
    expect(new Volume(45_000).equals(new Volume(45_000))).toBe(true)
    expect(new Volume(45_000).equals(new Volume(45_001))).toBe(false)
  })
})
