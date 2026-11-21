import type { NostrEvent, NostrFilter, NPool } from '@nostrify/nostrify';
import { VILLAGE_TOPIC, parseTribeId, villageTopic, villagesOf } from '@/lib/contentTags';
import { coordinateOf } from '@/lib/moderation';
import { tribeMembers, tribeModerators } from '@/lib/tribes';
import { slugifyVillage } from '@/lib/villages';

export interface VillageFeed {
  /** Content allowed into the requested villages, newest version of each address. */
  events: NostrEvent[];
  /** Coordinates featured in the requested villages by a moderator of the content's tribe. */
  featured: Set<string>;
}

const PROMOTED = 'village-promoted';
const FEATURED = 'village-featured';

function labelValue(label: NostrEvent): string | undefined {
  return label.tags.find(([name, value]) => name === 'l' && (value === PROMOTED || value === FEATURED))?.[1];
}

function labelVillages(label: NostrEvent): string[] {
  return label.tags.filter(([name]) => name === 'village').map(([, value]) => slugifyVillage(value ?? '')).filter(Boolean);
}

/** Tribe references of a piece of content: exact coordinates, or the legacy d tag. */
function tribeRefs(event: NostrEvent): { coordinates: string[]; legacyD?: string } {
  const coordinates = event.tags
    .filter(([name, value]) => name === 'a' && value?.startsWith('34550:'))
    .map(([, value]) => value);
  const legacyD = coordinates.length ? undefined : event.tags.find(([name]) => name === 'tribe')?.[1];
  return { coordinates, legacyD };
}

/** Fetch the tribe definitions referenced by `events` in one request. */
async function loadTribes(nostr: NPool, events: NostrEvent[], signal: AbortSignal): Promise<NostrEvent[]> {
  const byOwner = new Map<string, Set<string>>();
  const legacy = new Set<string>();
  for (const event of events) {
    const { coordinates, legacyD } = tribeRefs(event);
    for (const coordinate of coordinates) {
      const parsed = parseTribeId(coordinate.slice('34550:'.length));
      if (!parsed) continue;
      byOwner.set(parsed.pubkey, (byOwner.get(parsed.pubkey) ?? new Set()).add(parsed.identifier));
    }
    if (legacyD) legacy.add(legacyD);
  }
  const filters: NostrFilter[] = [...byOwner].map(([owner, ds]) => ({ kinds: [34550], authors: [owner], '#d': [...ds], limit: ds.size }));
  if (legacy.size) filters.push({ kinds: [34550], '#d': [...legacy], limit: legacy.size * 5 });
  return filters.length ? nostr.query(filters, { signal }) : [];
}

/**
 * Village eligibility. Content may appear in village V when:
 * - its tribe is associated with V (the tribe creator added V to the tribe), or
 * - its author is a moderator of its tribe (moderators' own village tags count), or
 * - a moderator of its tribe promoted it to V with a `village-promoted` label.
 * Self-applied village tags from anyone else, and labels from non-moderators, are ignored.
 */
export function makeVillageTrust(tribes: NostrEvent[]) {
  const byCoordinate = new Map(tribes.map(tribe => [coordinateOf(tribe), tribe]));
  const byD = new Map<string, NostrEvent[]>();
  for (const tribe of tribes) {
    const d = tribe.tags.find(([name]) => name === 'd')?.[1] ?? '';
    byD.set(d, [...(byD.get(d) ?? []), tribe]);
  }
  const tribesOf = (event: NostrEvent): NostrEvent[] => {
    const { coordinates, legacyD } = tribeRefs(event);
    return coordinates.length
      ? coordinates.map(coordinate => byCoordinate.get(coordinate)).filter((tribe): tribe is NostrEvent => !!tribe)
      // Legacy content only names a d tag: trust only tribes the author belongs to.
      : (byD.get(legacyD ?? '') ?? []).filter(tribe => tribeMembers(tribe).has(event.pubkey));
  };
  const moderatorsOf = (event: NostrEvent) => new Set(tribesOf(event).flatMap(tribeModerators));
  const associatedVillages = (event: NostrEvent) => new Set(tribesOf(event).flatMap(tribe =>
    tribe.tags.filter(([name]) => name === 'village').map(([, value]) => slugifyVillage(value ?? ''))));

  /** Villages the content is allowed into, given the labels referencing it. */
  const allowedVillages = (event: NostrEvent, labels: NostrEvent[]): Set<string> => {
    const moderators = moderatorsOf(event);
    const associated = associatedVillages(event);
    const allowed = new Set<string>();
    for (const village of villagesOf(event.tags)) {
      if (associated.has(village) || moderators.has(event.pubkey)) allowed.add(village);
    }
    for (const label of labels) {
      if (labelValue(label) === PROMOTED && moderators.has(label.pubkey)) {
        labelVillages(label).forEach(village => allowed.add(village));
      }
    }
    return allowed;
  };
  const featuredIn = (event: NostrEvent, labels: NostrEvent[]): Set<string> => {
    const moderators = moderatorsOf(event);
    return new Set(labels
      .filter(label => labelValue(label) === FEATURED && moderators.has(label.pubkey))
      .flatMap(labelVillages));
  };
  return { allowedVillages, featuredIn };
}

/**
 * Read village content with moderation applied.
 *
 * Content is found through the indexed `t` village topics (see contentTags.ts), with the
 * legacy multi-letter `#village` filter queried in parallel for older content. When that
 * legacy filter is unavailable (or nothing matched), it also scans recent content so older
 * posts keep appearing during the transition. Promoted content referenced by labels is
 * fetched by address. Finally only content its tribe's moderators allow is kept.
 *
 * `villages` empty means "all villages".
 */
export async function readVillageFeed(
  nostr: NPool, villages: string[], contentFilters: NostrFilter[], signal: AbortSignal,
): Promise<VillageFeed> {
  const labels = { kinds: [1985], '#l': [PROMOTED, FEATURED], limit: 200 };
  const wantsVillage = (village: string) => !villages.length || villages.includes(village);
  const isContent = (event: NostrEvent) => event.kind !== 1985;
  const topics = villages.length ? villages.map(villageTopic) : [VILLAGE_TOPIC];

  const [indexed, legacy] = await Promise.allSettled([
    nostr.query([...contentFilters.map(f => ({ ...f, '#t': topics })), labels], { signal }),
    // Separate REQ: some relays reject the whole subscription for multi-letter tag filters.
    villages.length
      ? nostr.query(contentFilters.map(f => ({ ...f, '#village': villages })), { signal })
      : Promise.resolve([] as NostrEvent[]),
  ]);
  signal.throwIfAborted();
  if (indexed.status === 'rejected' && legacy.status === 'rejected') throw indexed.reason;

  let records = [
    ...(indexed.status === 'fulfilled' ? indexed.value : []),
    ...(legacy.status === 'fulfilled' ? legacy.value : []),
  ];
  const tagged = (event: NostrEvent) => isContent(event) && villagesOf(event.tags).some(wantsVillage);
  // Legacy content is only reachable through `#village`, which some relays reject and others
  // silently answer with nothing, and the all-villages feed has no legacy filter at all. Unless
  // the legacy query itself returned matches, scan recent content so posts from before the
  // indexed tags keep showing (new indexed posts must not hide them).
  const legacyMatched = legacy.status === 'fulfilled' && legacy.value.some(tagged);
  if (!villages.length || !legacyMatched) {
    try {
      records = [...records, ...await nostr.query([...contentFilters, labels], { signal })];
    } catch (error) {
      signal.throwIfAborted();
      if (!records.length) throw error;
    }
  }

  const labelEvents = records.filter(event => event.kind === 1985 && labelValue(event));
  const labelsFor = new Map<string, NostrEvent[]>();
  for (const label of labelEvents) {
    for (const [name, address] of label.tags) {
      if (name === 'a' && address) labelsFor.set(address, [...(labelsFor.get(address) ?? []), label]);
    }
  }

  const candidates = records.filter(tagged);
  const kinds = new Set(contentFilters.flatMap(f => f.kinds ?? []));
  const present = new Set(candidates.map(coordinateOf));

  // Fetch content promoted into these villages that the content queries did not return.
  // One filter per kind+author keeps the REQ small (relays cap filters per subscription).
  const wanted = new Map<string, { kind: number; author: string; identifiers: Set<string> }>();
  for (const label of labelEvents) {
    if (labelValue(label) !== PROMOTED || !labelVillages(label).some(wantsVillage)) continue;
    for (const [name, address] of label.tags) {
      if (name !== 'a' || !address || present.has(address)) continue;
      const [kind, author, ...identifier] = address.split(':');
      if (kinds.has(Number(kind)) && /^[0-9a-f]{64}$/.test(author) && identifier.length) {
        const key = `${kind}:${author}`;
        const entry = wanted.get(key) ?? { kind: Number(kind), author, identifiers: new Set<string>() };
        entry.identifiers.add(identifier.join(':'));
        wanted.set(key, entry);
      }
    }
  }
  if (wanted.size) {
    try {
      candidates.push(...await nostr.query([...wanted.values()].map(({ kind, author, identifiers }) => ({
        kinds: [kind], authors: [author], '#d': [...identifiers], limit: identifiers.size,
      })), { signal }));
    } catch (error) {
      signal.throwIfAborted();
      if (!candidates.length) throw error;
    }
  }

  // Results come from several requests: keep only the newest version of each address.
  const newest = new Map<string, NostrEvent>();
  for (const event of candidates) {
    const key = coordinateOf(event);
    const current = newest.get(key);
    if (!current || event.created_at > current.created_at) newest.set(key, event);
  }

  // Apply moderation, with one request for the tribes behind every candidate.
  const trust = makeVillageTrust(await loadTribes(nostr, [...newest.values()], signal));
  const events: NostrEvent[] = [];
  const featured = new Set<string>();
  for (const [address, event] of newest) {
    const related = labelsFor.get(address) ?? [];
    if ([...trust.allowedVillages(event, related)].some(wantsVillage)) {
      events.push(event);
      if ([...trust.featuredIn(event, related)].some(wantsVillage)) featured.add(address);
    }
  }
  return { events, featured };
}
