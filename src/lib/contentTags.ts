import { slugifyVillage } from '@/lib/villages';

/**
 * Tags linking content (events, stories, services) to its tribe and villages.
 *
 * Relays only index single-letter tags, so each link is written twice:
 * - tribe: `['a', '34550:<owner>:<d>']` (NIP-72 community reference, indexed) and
 *   the legacy `['tribe', '<d>']`;
 * - village: `['t', 'village']` + `['t', 'village-<slug>']` (indexed) and the
 *   legacy `['village', '<slug>']`.
 *
 * Readers query the indexed tags and fall back to the legacy ones for content
 * published before this change.
 */

/** Generic topic shared by all village-tagged content (used by the "all villages" feed). */
export const VILLAGE_TOPIC = 'village';

export function villageTopic(slug: string): string {
  return `${VILLAGE_TOPIC}-${slug}`;
}

/** `owner:d` tribe id -> `34550:owner:d` coordinate. */
export function tribeCoordinate(tribeId: string): string {
  return `34550:${tribeId}`;
}

/** Split a `owner:d` tribe id. The d tag may itself contain colons. */
export function parseTribeId(tribeId: string): { pubkey: string; identifier: string } | null {
  const [pubkey, ...rest] = tribeId.split(':');
  const identifier = rest.join(':');
  return /^[0-9a-f]{64}$/.test(pubkey) && identifier ? { pubkey, identifier } : null;
}

/** Tags tying new content to a tribe. */
export function tribeTags(tribeId: string): string[][] {
  const parsed = parseTribeId(tribeId);
  if (!parsed) throw new Error('Invalid tribe id');
  return [['a', tribeCoordinate(tribeId)], ['tribe', parsed.identifier]];
}

function isVillageTag([name, value]: string[]): boolean {
  return name === 'village' || (name === 't' && (value === VILLAGE_TOPIC || value?.startsWith(`${VILLAGE_TOPIC}-`)));
}

/** Replace all village tags (legacy and indexed) with tags for `villages`. */
export function withVillageTags(tags: string[][], villages: string[]): string[][] {
  const slugs = [...new Set(villages.map(slugifyVillage).filter(Boolean))];
  const rest = tags.filter(tag => !isVillageTag(tag));
  if (!slugs.length) return rest;
  return [
    ...rest,
    ...slugs.map(slug => ['village', slug]),
    ['t', VILLAGE_TOPIC],
    ...slugs.map(slug => ['t', villageTopic(slug)]),
  ];
}

/** Village slugs an event is tagged with (legacy or indexed form). */
export function villagesOf(tags: string[][]): string[] {
  const prefix = `${VILLAGE_TOPIC}-`;
  return [...new Set(tags.flatMap(([name, value]) => {
    if (name === 'village' && value) return [value];
    if (name === 't' && value?.startsWith(prefix)) return [value.slice(prefix.length)];
    return [];
  }))];
}

/** Whether content belongs to the tribe, by indexed coordinate or legacy d tag. */
export function belongsToTribe(tags: string[][], tribeId: string): boolean {
  const parsed = parseTribeId(tribeId);
  if (!parsed) return false;
  const coordinate = tribeCoordinate(tribeId);
  if (tags.some(([name, value]) => name === 'a' && value === coordinate)) return true;
  // Legacy content only carries the d tag; ignore it when the content names a different tribe.
  const pointsElsewhere = tags.some(([name, value]) => name === 'a' && value?.startsWith('34550:') && value !== coordinate);
  return !pointsElsewhere && tags.some(([name, value]) => name === 'tribe' && (value === parsed.identifier || value === tribeId));
}

/** Tribe tags for a `owner:d` tribe id, or only the legacy tag for a bare d tag. */
export function tribeLinkTags(tribe: string): string[][] {
  return parseTribeId(tribe) ? tribeTags(tribe) : [['tribe', tribe]];
}
