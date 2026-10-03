import { GRID_SIZE, SPACING_MILES } from "./config";
import type { GridPoint } from "./types";

/*
 * Grid math
 * ---------
 * Points form a GRID_SIZE x GRID_SIZE square centred on (lat0, lng0), SPACING_MILES apart.
 * For row r and column c (0-based), the offset from the centre in steps is
 *     dy = (GRID_SIZE - 1) / 2 - r     (positive = north; row 0 is the north edge)
 *     dx = c - (GRID_SIZE - 1) / 2     (positive = east;  col 0 is the west edge)
 * so a 5x5 grid has steps -2..+2 on each axis.
 *
 * Step length in metres: d = SPACING_MILES * 1609.344.
 * Treating the Earth as a sphere of radius R = 6,371,008.8 m:
 *     metres per degree of latitude  = pi * R / 180            (about 111,195 m)
 *     metres per degree of longitude = pi * R / 180 * cos(lat0)
 * giving
 *     lat = lat0 + (dy * d) / metresPerDegLat
 *     lng = lng0 + (dx * d) / (metresPerDegLat * cos(lat0))
 * cos(lat0) is taken at the centre for every point. Across a 2 mile span the error is
 * negligible. Results are rounded to 7 decimals (the maximum task_post accepts).
 * Callers must keep |lat0| well below 90 (validation caps it at 85) so cos(lat0) > 0.
 */

const METERS_PER_MILE = 1609.344;
const EARTH_RADIUS_M = 6_371_008.8;
const METERS_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_M) / 180;

const round7 = (n: number) => Math.round(n * 1e7) / 1e7;

/** Wrap a longitude into [-180, 180]. */
const wrapLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;

export function buildGrid(lat0: number, lng0: number): GridPoint[] {
  const stepM = SPACING_MILES * METERS_PER_MILE;
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const mid = (GRID_SIZE - 1) / 2;

  const points: GridPoint[] = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const dy = mid - row;
      const dx = col - mid;
      points.push({
        row,
        col,
        lat: round7(lat0 + (dy * stepM) / METERS_PER_DEG_LAT),
        lng: round7(wrapLng(lng0 + (dx * stepM) / metersPerDegLng)),
      });
    }
  }
  return points;
}
