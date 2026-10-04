import { describe, expect, it } from 'vitest'
import { Area, AreaCell } from '../../../src/domain/area.ts'
import { InvalidProfileFieldError } from '../../../src/domain/errors.ts'

describe('Area — §4: latitude −90 to 90, longitude −180 to 180, in degrees', () => {
  it.each([
    [-90, -180],
    [90, 180],
    [0, 0],
    [14, 100],
    [13.731723456, 100.541532],
  ])('accepts %p, %p', (latitude, longitude) => {
    const area = new Area(latitude, longitude)
    expect(area.latitude).toBe(latitude)
    expect(area.longitude).toBe(longitude)
  })

  it.each([
    [90.000001, 0],
    [-90.000001, 0],
    [0, 180.000001],
    [0, -180.000001],
    [100.54, 13.73],
  ])('rejects %p, %p as off the map', (latitude, longitude) => {
    expect(() => new Area(latitude, longitude)).toThrow(InvalidProfileFieldError)
  })

  it.each([
    [Number.NaN, 0],
    [0, Number.NaN],
    [Number.POSITIVE_INFINITY, 0],
    [0, Number.NEGATIVE_INFINITY],
  ])('rejects %p, %p as not a coordinate', (latitude, longitude) => {
    expect(() => new Area(latitude, longitude)).toThrow(InvalidProfileFieldError)
  })

  it('names the field it rejected', () => {
    expect(() => new Area(91, 0)).toThrow(expect.objectContaining({ field: 'area' }))
  })

  it('is compared by value, not identity', () => {
    expect(new Area(13.7314, 100.5414).equals(new Area(13.7314, 100.5414))).toBe(true)
    expect(new Area(13.7314, 100.5414).equals(new Area(13.7314, 100.5415))).toBe(false)
  })

  it('is immutable', () => {
    const area = new Area(13.7314, 100.5414)
    expect(() => {
      ;(area as { latitude: number }).latitude = 0
    }).toThrow(TypeError)
  })
})

describe('AreaCell — §4: the point nearest the area whose coordinates are multiples of 0.01°', () => {
  it('rounds each coordinate down to the nearest hundredth', () => {
    const cell = new Area(13.73172, 100.54153).cell()
    expect(cell.latitude).toBe(13.73)
    expect(cell.longitude).toBe(100.54)
  })

  it('rounds up when up is nearer', () => {
    const cell = new Area(13.7389, 100.5461).cell()
    expect(cell.latitude).toBe(13.74)
    expect(cell.longitude).toBe(100.55)
  })

  it('rounds a negative coordinate to the nearest hundredth too', () => {
    const cell = new Area(-33.86882, 151.20929).cell()
    expect(cell.latitude).toBe(-33.87)
    expect(cell.longitude).toBe(151.21)
  })

  it('stays on the map at its edges', () => {
    expect(new Area(89.996, 179.996).cell()).toMatchObject({ latitude: 90, longitude: 180 })
    expect(new Area(-89.996, -179.996).cell()).toMatchObject({ latitude: -90, longitude: -180 })
  })

  it('leaves a point already on the grid where it is', () => {
    const cell = new Area(14, 100).cell()
    expect(cell.latitude).toBe(14)
    expect(cell.longitude).toBe(100)
  })

  it('gives every point near the same grid point the same cell', () => {
    const one = new Area(13.7351, 100.5449).cell()
    const other = new Area(13.7449, 100.5351).cell()
    expect(one.equals(other)).toBe(true)
    expect(one).toMatchObject({ latitude: 13.74, longitude: 100.54 })
  })

  it('tells different cells apart', () => {
    expect(new Area(13.73, 100.54).cell().equals(new Area(13.75, 100.54).cell())).toBe(false)
  })

  it('is what an Area makes of itself', () => {
    const area = new Area(13.7314, 100.5414)
    expect(new AreaCell(area).equals(area.cell())).toBe(true)
  })

  it('is immutable', () => {
    const cell = new Area(13.7314, 100.5414).cell()
    expect(() => {
      ;(cell as { latitude: number }).latitude = 0
    }).toThrow(TypeError)
  })
})
