import { describe, expect, it } from 'vitest'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import { toPace } from '../../../src/domain/pace.ts'

describe('toPace — §4: decimal minutes per km, 0 < x ≤ 20 as given, kept to the nearest second', () => {
  it.each([
    [6.5, 6.5],
    [6.3333, 6.333333333333333],
    [20, 20],
    [19.999, 20],
    [0.01, 1 / 60],
  ])('keeps %p as %p', (given, kept) => {
    expect(toPace(given, 'paceMin')).toBe(kept)
  })

  it.each([0, -1, 20.0001, Number.NaN, Number.POSITIVE_INFINITY])('refuses %p', (given) => {
    expect(() => toPace(given, 'paceMax')).toThrow(InvalidProfileFieldError)
  })

  it('refuses a pace that rounds to 0 seconds', () => {
    expect(() => toPace(0.004, 'paceMin')).toThrow(InvalidProfileFieldError)
  })

  it('names the field it was given', () => {
    expect(() => toPace(0, 'paceMin')).toThrow(expect.objectContaining({ field: 'paceMin' }))
    expect(() => toPace(21, 'paceMax')).toThrow(expect.objectContaining({ field: 'paceMax' }))
  })

  it('keeps what it kept: rounding a stored pace again changes nothing', () => {
    const kept = toPace(6.3333, 'paceMin')
    expect(toPace(kept, 'paceMin')).toBe(kept)
    expect(toPace(320 / 60, 'paceMin')).toBe(320 / 60)
  })
})
