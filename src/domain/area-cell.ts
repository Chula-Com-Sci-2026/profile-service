/**
 * The point rounded to about a kilometre — domain.md §4 "Area cells": the point nearest a
 * latitude and longitude whose coordinates are both multiples of 0.01°. What other runners are
 * shown instead of the point itself.
 *
 * It rounds what it is given, so a cell can never be made from exact numbers that skipped the
 * rounding. The point's own range is the profile's rule, checked before a cell is asked for.
 */
export class AreaCell {
  readonly latitude: number
  readonly longitude: number

  constructor(latitude: number, longitude: number) {
    this.latitude = toHundredths(latitude)
    this.longitude = toHundredths(longitude)
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
