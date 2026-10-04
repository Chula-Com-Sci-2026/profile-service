import { ensure } from './errors.ts'

/** Where a runner usually runs, as one point on the map — domain.md §4: degrees, WGS 84. */
export class Area {
  readonly latitude: number
  readonly longitude: number

  constructor(latitude: number, longitude: number) {
    // NaN fails both comparisons, and so does an infinity, so the range is the whole check.
    ensure(latitude >= -90 && latitude <= 90, 'area', 'must have a latitude between -90 and 90')
    ensure(longitude >= -180 && longitude <= 180, 'area', 'must have a longitude between -180 and 180')
    this.latitude = latitude
    this.longitude = longitude
    Object.freeze(this)
  }

  equals(other: Area): boolean {
    return this.latitude === other.latitude && this.longitude === other.longitude
  }

  /** What other runners are shown instead of this point — domain.md §4 "Area cells". */
  cell(): AreaCell {
    return new AreaCell(this)
  }
}

/**
 * An area rounded to about a kilometre — domain.md §4 "Area cells": the point nearest the area
 * whose latitude and longitude are both multiples of 0.01°.
 *
 * Built from an `Area` and nothing else, so a cell can never be made from exact numbers that
 * skipped the rounding.
 */
export class AreaCell {
  readonly latitude: number
  readonly longitude: number

  constructor(area: Area) {
    this.latitude = toHundredths(area.latitude)
    this.longitude = toHundredths(area.longitude)
    Object.freeze(this)
  }

  equals(other: AreaCell): boolean {
    return this.latitude === other.latitude && this.longitude === other.longitude
  }
}

/**
 * Rounding each coordinate on its own gives the nearest grid point. A whole number of hundredths
 * divided by 100 is the closest double to that decimal, so it prints with at most two places.
 * Exact halves follow floating point (`1.005` → `1`) — deterministic, which is what matters.
 */
function toHundredths(degrees: number): number {
  return Math.round(degrees * 100) / 100
}
