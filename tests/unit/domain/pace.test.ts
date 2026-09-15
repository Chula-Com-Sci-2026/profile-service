import { describe, expect, it } from 'vitest'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import { Pace } from '../../../src/domain/pace.ts'

describe('Pace — §4: integer seconds per kilometre, 150–900', () => {
  it.each([150, 300, 900])('accepts %i', (seconds) => {
    expect(new Pace(seconds).secondsPerKilometre).toBe(seconds)
  })

  it.each([149, 901, 0, -1])('rejects %i as out of range', (seconds) => {
    expect(() => new Pace(seconds)).toThrow(InvalidProfileFieldError)
  })

  it.each([300.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %p as not a whole number', (seconds) => {
    expect(() => new Pace(seconds)).toThrow(InvalidProfileFieldError)
  })

  it('names the field it rejected', () => {
    expect(() => new Pace(10)).toThrow(expect.objectContaining({ field: 'pace' }))
  })

  it('is compared by value, not identity', () => {
    expect(new Pace(300).equals(new Pace(300))).toBe(true)
    expect(new Pace(300).equals(new Pace(301))).toBe(false)
  })

  it('is immutable', () => {
    const pace = new Pace(300)
    expect(() => {
      ;(pace as { secondsPerKilometre: number }).secondsPerKilometre = 400
    }).toThrow(TypeError)
  })
})
