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

/** Centre of a geohash cell, or undefined for an invalid hash. */
export function decodeGeohash(hash: string): { lat: number; lon: number } | undefined {
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
  return hash ? { lat: (latRange[0] + latRange[1]) / 2, lon: (lonRange[0] + lonRange[1]) / 2 } : undefined;
}

/** Tags for an optional location; empty when no valid coordinates were given. */
export function locationTags(lat?: number, lon?: number): string[][] {
  if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
  return [['g', encodeGeohash(lat, lon)]];
}

/** Read a location from a geohash `g` tag, or a legacy `["l", "<lat>,<lon>"]` tag. */
export function readLocation(tags: string[][]): { lat: number; lon: number } | undefined {
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
