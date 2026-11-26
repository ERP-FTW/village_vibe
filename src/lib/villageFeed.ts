import type { NostrEvent, NostrFilter, NPool } from '@nostrify/nostrify';
import { VILLAGE_TOPIC, parseTribeId, villageTopic, villagesOf } from '@/lib/contentTags';
import { coordinateOf } from '@/lib/moderation';
import { tribeMembers, tribeModerators } from '@/lib/tribes';
import { slugifyVillage } from '@/lib/villages';

export interface VillageFeed {
  /** Content allowed into the requested villages, newest version of each address. */
  events: NostrEvent[];
  /**
   * The tribe definitions the content names, as read for this feed. Besides deciding what
   * a village admits, they hold the member lists that decide who is shown a tribe-only event.
   */
  tribes: NostrEvent[];
  /** Coordinates featured in the requested villages by a moderator of the content's tribe. */
  featured: Set<string>;
  /**
   * False when promotion discovery may have missed promotions (and the content they bring
   * in): a window was full, or a crowded second held more labels than a relay will list.
   */
  promotionsComplete: boolean;
  /** Reading more windows (`promotionPages`) can find more; false once only skips remain. */
  promotionsCanReadFurther: boolean;
}

export interface VillageFeedOptions {
  /** Windows of promotion labels to read per source, newest first (1 = newest window only). */
  promotionPages?: number;
}

const PROMOTED = 'village-promoted';
const FEATURED = 'village-featured';
/** Labels read per discovery window. */
export const LABEL_WINDOW = 200;
export const MAX_PROMOTION_PAGES = 10;

function labelValue(label: NostrEvent): string | undefined {
  return label.tags.find(([name, value]) => name === 'l' && (value === PROMOTED || value === FEATURED))?.[1];
}

/** Villages a label applies to (legacy `village` tags or indexed `t` village topics). */
function labelVillages(label: NostrEvent): string[] {
  return villagesOf(label.tags).map(value => slugifyVillage(value)).filter(Boolean);
}

function promotionFilter(scope: NostrFilter, until?: number): NostrFilter {
  return { kinds: [1985], '#l': [PROMOTED, FEATURED], limit: LABEL_WINDOW, ...scope, ...(until !== undefined ? { until } : {}) };
}

/** A way of finding promotion labels, and how far back it has been read. */
interface LabelSource {
  scope: NostrFilter;
  /** More labels may exist before `until` (the window was full). */
  saturated: boolean;
  until?: number;
  /** Paging had to step past a second holding more labels than a window: some can't be read. */
  skipped?: boolean;
}

/** Window state after reading `labels` (newest first) for one source. */
function windowState(scope: NostrFilter, labels: NostrEvent[], previous?: LabelSource): LabelSource {
  const skipped = previous?.skipped;
  if (labels.length < LABEL_WINDOW) return { scope, saturated: false, skipped };
  const sorted = [...labels].sort((a, b) => b.created_at - a.created_at);
  const oldest = sorted[LABEL_WINDOW - 1].created_at;
  // Inclusive paging. Only a full window that can't move the cursor back (every label at the
  // `until` second) means that second holds more labels than a relay lists: step past it and
  // remember that some labels couldn't be read. Labels already known from another source
  // don't count either way.
  if (previous?.until !== undefined && oldest >= previous.until) {
    return { scope, saturated: true, until: previous.until - 1, skipped: true };
  }
  return { scope, saturated: true, until: oldest, skipped };
}

/** A source whose first window couldn't be read: incomplete, and retried by reading further. */
function failedSource(scope: NostrFilter): LabelSource {
  return { scope, saturated: true };
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
 * - its tribe is associated with V (the tribe creator added V to the tribe) and the
 *   author belongs to that tribe, or
 * - its author is a moderator of its tribe (moderators' own village tags count), or
 * - a moderator of its tribe promoted it to V with a `village-promoted` label.
 * "Its tribe" means the tribe named by the content's `a` coordinate with the author as
 * a member. Self-applied village tags from anyone else, labels from non-moderators, and
 * moderator authority derived from ambiguous legacy d tags are ignored.
 */
export function makeVillageTrust(tribes: NostrEvent[]) {
  const byCoordinate = new Map(tribes.map(tribe => [coordinateOf(tribe), tribe]));
  const byD = new Map<string, NostrEvent[]>();
  for (const tribe of tribes) {
    const d = tribe.tags.find(([name]) => name === 'd')?.[1] ?? '';
    byD.set(d, [...(byD.get(d) ?? []), tribe]);
  }
  /**
   * Tribes vouching for content. Only an author-qualified tribe coordinate (`a` tag) gives
   * moderator authority, and only when the content's author is a member of that tribe.
   * Legacy content names just a d tag, which anyone can reuse for a look-alike tribe, so
   * such matches only honour the author's own village tags (when the tribe is associated
   * with the village) and never grant moderator authority.
   */
  const authenticatedTribes = (event: NostrEvent): NostrEvent[] => tribeRefs(event).coordinates
    .map(coordinate => byCoordinate.get(coordinate))
    .filter((tribe): tribe is NostrEvent => !!tribe && tribeMembers(tribe).has(event.pubkey));
  const legacyTribes = (event: NostrEvent): NostrEvent[] => {
    const { coordinates, legacyD } = tribeRefs(event);
    if (coordinates.length || !legacyD) return [];
    return (byD.get(legacyD) ?? []).filter(tribe => tribeMembers(tribe).has(event.pubkey));
  };
  const moderatorsOf = (event: NostrEvent) => new Set(authenticatedTribes(event).flatMap(tribeModerators));
  const associatedVillages = (event: NostrEvent) => new Set([...authenticatedTribes(event), ...legacyTribes(event)]
    .flatMap(tribe => tribe.tags.filter(([name]) => name === 'village').map(([, value]) => slugifyVillage(value ?? ''))));

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
  options: VillageFeedOptions = {},
): Promise<VillageFeed> {
  const wantsVillage = (village: string) => !villages.length || villages.includes(village);
  const isContent = (event: NostrEvent) => event.kind !== 1985;
  const topics = villages.length ? villages.map(villageTopic) : [VILLAGE_TOPIC];

  // Promotion labels come from three sources:
  // - indexed: labels carrying `t` village topics (written since the indexed tag model),
  // - legacy: labels with only multi-letter `village` tags, queried by `#village` (some
  //   relays reject such filters, so it shares the separate legacy REQ),
  // - recent: the newest labels overall, a bounded fallback for legacy labels when the
  //   legacy filter is unavailable (all-villages feed, or a relay rejecting it).
  const indexedScope: NostrFilter = { '#t': topics };
  const legacyScope: NostrFilter = { '#village': villages };
  const recentScope: NostrFilter = {};

  const [indexed, legacy] = await Promise.allSettled([
    nostr.query([...contentFilters.map(f => ({ ...f, '#t': topics })), promotionFilter(indexedScope), promotionFilter(recentScope)], { signal }),
    // Separate REQ: some relays reject the whole subscription for multi-letter tag filters.
    villages.length
      ? nostr.query([...contentFilters.map(f => ({ ...f, '#village': villages })), promotionFilter(legacyScope)], { signal })
      : Promise.resolve([] as NostrEvent[]),
  ]);
  signal.throwIfAborted();
  if (indexed.status === 'rejected' && legacy.status === 'rejected') throw indexed.reason;

  const indexedRecords = indexed.status === 'fulfilled' ? indexed.value : [];
  const legacyRecords = legacy.status === 'fulfilled' ? legacy.value : [];
  let records = [...indexedRecords, ...legacyRecords];
  const tagged = (event: NostrEvent) => isContent(event) && villagesOf(event.tags).some(wantsVillage);
  // Legacy content is only reachable through `#village`, which some relays reject and others
  // silently answer with nothing, and the all-villages feed has no legacy filter at all. Unless
  // the legacy query itself returned matches, scan recent content so posts from before the
  // indexed tags keep showing (new indexed posts must not hide them).
  const legacyMatched = legacy.status === 'fulfilled' && legacyRecords.some(tagged);
  // If the indexed REQ failed, its promotion labels are requested again with the scan.
  let labelRecords: NostrEvent[] | undefined = indexed.status === 'fulfilled' ? indexedRecords : undefined;
  if (!villages.length || !legacyMatched || !labelRecords) {
    const retryLabels = !labelRecords;
    try {
      const scanned = await nostr.query(
        retryLabels ? [...contentFilters, promotionFilter(indexedScope), promotionFilter(recentScope)] : contentFilters,
        { signal },
      );
      records = [...records, ...scanned];
      if (retryLabels) labelRecords = scanned;
    } catch (error) {
      signal.throwIfAborted();
      if (!records.length) throw error;
    }
  }

  // Where each label source stands after the first window
  const isPromotion = (event: NostrEvent) => event.kind === 1985 && !!labelValue(event);
  const seen = new Set<string>();
  const indexedLabels = (labelRecords ?? []).filter(isPromotion);
  // A relay may answer an unsupported `#village` filter with nothing instead of rejecting
  // it, so the legacy source only replaces the recent fallback once it has returned matches.
  const legacyAvailable = villages.length > 0 && legacy.status === 'fulfilled'
    && legacyRecords.some(event => isPromotion(event) || tagged(event));
  const sources = {
    // Neither request carrying these labels succeeded: incomplete, retried by reading further
    indexed: labelRecords
      ? windowState(indexedScope, indexedLabels.filter(label => label.tags.some(([name, value]) => name === 't' && topics.includes(value))))
      : failedSource(indexedScope),
    // The recent window is the newest LABEL_WINDOW labels of the indexed REQ's results
    recent: labelRecords ? windowState(recentScope, indexedLabels) : failedSource(recentScope),
    legacy: legacyAvailable ? windowState(legacyScope, legacyRecords.filter(isPromotion)) : undefined,
  };
  [...indexedLabels, ...legacyRecords.filter(isPromotion)].forEach(label => seen.add(label.id));
  // The sources that decide completeness: legacy labels are fully covered by the legacy
  // filter when it works, otherwise only the bounded recent window can find them.
  const deciding = (): LabelSource[] => [sources.indexed, sources.legacy ?? sources.recent];

  // Further windows, only when asked for and only for sources that were full
  const discovered: NostrEvent[] = [];
  const pages = Math.min(Math.max(options.promotionPages ?? 1, 1), MAX_PROMOTION_PAGES);
  for (let page = 1; page < pages; page++) {
    const full = deciding().filter(source => source.saturated);
    if (!full.length) break;
    const windows = await Promise.allSettled(full.map(source => nostr.query([promotionFilter(source.scope, source.until)], { signal })));
    signal.throwIfAborted();
    windows.forEach((result, i) => {
      const source = full[i];
      const key = source === sources.indexed ? 'indexed' : source === sources.legacy ? 'legacy' : 'recent';
      if (result.status === 'rejected') return; // stays full: still incomplete
      const labels = result.value.filter(isPromotion);
      sources[key] = windowState(source.scope, labels, source);
      labels.forEach(label => { if (!seen.has(label.id)) { seen.add(label.id); discovered.push(label); } });
    });
  }
  const promotionsComplete = deciding().every(source => !source.saturated && !source.skipped);
  const promotionsCanReadFurther = deciding().some(source => source.saturated);
  records = [...records, ...discovered];

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

  // Apply moderation. In parallel: the tribes behind every candidate, and the promotion and
  // feature labels for exactly these candidates (the discovery query above only sees the
  // newest labels overall, so older labels for this content could be missing from it).
  const candidateAddresses = [...newest.keys()];
  const [tribes, scopedLabels] = await Promise.all([
    loadTribes(nostr, [...newest.values()], signal),
    candidateAddresses.length
      ? nostr.query([{ kinds: [1985], '#l': [PROMOTED, FEATURED], '#a': candidateAddresses, limit: candidateAddresses.length * 5 + 50 }], { signal })
      : Promise.resolve([] as NostrEvent[]),
  ]);
  const seenLabels = new Set(labelEvents.map(label => label.id));
  for (const label of scopedLabels) {
    if (seenLabels.has(label.id) || !labelValue(label)) continue;
    seenLabels.add(label.id);
    for (const [name, address] of label.tags) {
      if (name === 'a' && address) labelsFor.set(address, [...(labelsFor.get(address) ?? []), label]);
    }
  }
  const trust = makeVillageTrust(tribes);
  const events: NostrEvent[] = [];
  const featured = new Set<string>();
  for (const [address, event] of newest) {
    const related = labelsFor.get(address) ?? [];
    if ([...trust.allowedVillages(event, related)].some(wantsVillage)) {
      events.push(event);
      if ([...trust.featuredIn(event, related)].some(wantsVillage)) featured.add(address);
    }
  }
  return { events, tribes, featured, promotionsComplete, promotionsCanReadFurther };
}
