/**
 * Location tags. New content uses a NIP-52 style geohash `g` tag (precision 6, about a
 * 1 km cell, for privacy) and only when the author provides a location. Older content
 * stored `["l", "<lat>,<lon>"]`, which collides with NIP-32 label tags; it is still read.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(lat: number, lon: number, precision = 6): string {
  let latRange = [-90, 90];
  let lonRange = [-180, 180];
  let hash = '';
  let bit = 0;
  let ch = 0;
  let evenBit = true;
  while (hash.length < precision) {
    const range = evenBit ? lonRange : latRange;
    const value = evenBit ? lon : lat;
    const mid = (range[0] + range[1]) / 2;
    if (value >= mid) {
      ch = (ch << 1) | 1;
      range[0] = mid;
    } else {
      ch = ch << 1;
      range[1] = mid;
    }
    if (evenBit) lonRange = range; else latRange = range;
    evenBit = !evenBit;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

export interface LatLon { lat: number; lon: number }
interface Bounds { minLat: number; maxLat: number; minLon: number; maxLon: number }

/** The area a geohash cell covers, or undefined for an invalid hash. */
function geohashBounds(hash: string): Bounds | undefined {
  if (!hash) return undefined;
  const latRange = [-90, 90];
  const lonRange = [-180, 180];
  let evenBit = true;
  for (const char of hash.toLowerCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) return undefined;
    for (let bit = 4; bit >= 0; bit--) {
      const range = evenBit ? lonRange : latRange;
      const mid = (range[0] + range[1]) / 2;
      if ((index >> bit) & 1) range[0] = mid; else range[1] = mid;
      evenBit = !evenBit;
    }
  }
  return { minLat: latRange[0], maxLat: latRange[1], minLon: lonRange[0], maxLon: lonRange[1] };
}

/** Centre of a geohash cell, or undefined for an invalid hash. */
export function decodeGeohash(hash: string): LatLon | undefined {
  const bounds = geohashBounds(hash);
  return bounds && { lat: (bounds.minLat + bounds.maxLat) / 2, lon: (bounds.minLon + bounds.maxLon) / 2 };
}

/** Great-circle distance in miles. */
export function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Distance in miles from `from` to the closest place the tagged location could be, or
 * undefined without a location. A geohash only says which cell (about 0.4 x 0.6 miles at
 * precision 6) the author is in, so this measures to the nearest point of that cell: zero
 * when the reader is inside it. Legacy `l` coordinates are exact points.
 */
export function nearestDistanceMiles(from: LatLon, tags: string[][]): number | undefined {
  const geohash = tags.find(([name, value]) => name === 'g' && !!value)?.[1];
  const bounds = geohash ? geohashBounds(geohash) : undefined;
  if (bounds) {
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    return distanceMiles(from.lat, from.lon, clamp(from.lat, bounds.minLat, bounds.maxLat), clamp(from.lon, bounds.minLon, bounds.maxLon));
  }
  const point = readLocation(tags);
  return point && distanceMiles(from.lat, from.lon, point.lat, point.lon);
}

/** Tags for an optional location; empty when no valid coordinates were given. */
export function locationTags(lat?: number, lon?: number): string[][] {
  if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
  return [['g', encodeGeohash(lat, lon)]];
}

/** Read a location from a geohash `g` tag, or a legacy `["l", "<lat>,<lon>"]` tag. */
export function readLocation(tags: string[][]): LatLon | undefined {
  const geohash = tags.find(([name, value]) => name === 'g' && !!value)?.[1];
  if (geohash) return decodeGeohash(geohash);
  for (const tag of tags) {
    // Legacy coordinates are two-element tags; NIP-32 labels carry a namespace
    const [name, value] = tag;
    if (name !== 'l' || !value || tag.length !== 2) continue;
    const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(value);
    if (match) {
      const lat = Number(match[1]);
      const lon = Number(match[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
    }
  }
  return undefined;
}
