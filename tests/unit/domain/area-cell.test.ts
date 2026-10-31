import { describe, expect, it } from 'vitest'
import { AreaCell } from '../../../src/domain/area-cell.ts'

describe('AreaCell — §4: the point nearest a latitude and longitude whose coordinates are multiples of 0.01°', () => {
  it('rounds each coordinate down to the nearest hundredth', () => {
    const cell = new AreaCell(13.73172, 100.54153)
    expect(cell.latitude).toBe(13.73)
    expect(cell.longitude).toBe(100.54)
  })

  it('rounds up when up is nearer', () => {
    const cell = new AreaCell(13.7389, 100.5461)
    expect(cell.latitude).toBe(13.74)
    expect(cell.longitude).toBe(100.55)
  })

  it('rounds a negative coordinate to the nearest hundredth too', () => {
    const cell = new AreaCell(-33.86882, 151.20929)
    expect(cell.latitude).toBe(-33.87)
    expect(cell.longitude).toBe(151.21)
  })

  it('stays on the map at its edges', () => {
    expect(new AreaCell(89.996, 179.996)).toMatchObject({ latitude: 90, longitude: 180 })
    expect(new AreaCell(-89.996, -179.996)).toMatchObject({ latitude: -90, longitude: -180 })
  })

  it('leaves a point already on the grid where it is', () => {
    const cell = new AreaCell(14, 100)
    expect(cell.latitude).toBe(14)
    expect(cell.longitude).toBe(100)
  })

  it('gives every point near the same grid point the same cell', () => {
    const one = new AreaCell(13.7351, 100.5449)
    const other = new AreaCell(13.7449, 100.5351)
    expect(one.equals(other)).toBe(true)
    expect(one).toMatchObject({ latitude: 13.74, longitude: 100.54 })
  })

  it('tells different cells apart', () => {
    expect(new AreaCell(13.73, 100.54).equals(new AreaCell(13.75, 100.54))).toBe(false)
  })

  it('is immutable', () => {
    const cell = new AreaCell(13.7314, 100.5414)
    expect(() => {
      ;(cell as { latitude: number }).latitude = 0
    }).toThrow(TypeError)
  })
})
