import { describe, expect, it } from 'vitest'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'
import { PaceRange } from '../../../src/domain/pace-range.ts'

describe('PaceRange — §4: a fastest and a slowest pace, fastest no slower than slowest', () => {
  it('holds both ends as paces', () => {
    const range = new PaceRange(330, 390)
    expect(range.fastest.secondsPerKilometre).toBe(330)
    expect(range.slowest.secondsPerKilometre).toBe(390)
  })

  it('accepts one steady pace as both ends', () => {
    const range = new PaceRange(330, 330)
    expect(range.fastest.equals(range.slowest)).toBe(true)
  })

  it('rejects a fastest pace slower than the slowest', () => {
    expect(() => new PaceRange(390, 330)).toThrow(InvalidProfileFieldError)
    expect(() => new PaceRange(390, 330)).toThrow('paceRange must not have a fastest pace slower than its slowest')
  })

  it.each([
    [149, 300],
    [300, 901],
    [300.5, 400],
  ])('rejects %p–%p, because an end breaks the pace rule', (fastest, slowest) => {
    expect(() => new PaceRange(fastest, slowest)).toThrow(InvalidProfileFieldError)
  })

  it('names paceRange as the field, whichever rule broke', () => {
    expect(() => new PaceRange(390, 330)).toThrow(expect.objectContaining({ field: 'paceRange' }))
    expect(() => new PaceRange(10, 330)).toThrow(expect.objectContaining({ field: 'paceRange' }))
  })

  it('is compared by value, not identity', () => {
    expect(new PaceRange(330, 390).equals(new PaceRange(330, 390))).toBe(true)
    expect(new PaceRange(330, 390).equals(new PaceRange(330, 391))).toBe(false)
    expect(new PaceRange(330, 390).equals(new PaceRange(331, 390))).toBe(false)
  })

  it('is immutable', () => {
    const range = new PaceRange(330, 390)
    expect(() => {
      ;(range as { fastest: unknown }).fastest = null
    }).toThrow(TypeError)
  })
})
