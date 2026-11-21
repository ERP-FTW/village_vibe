import type { NostrEvent, NostrFilter, NPool } from '@nostrify/nostrify';
import { VILLAGE_TOPIC, villageTopic, villagesOf } from '@/lib/contentTags';
import { coordinateOf } from '@/lib/moderation';

/**
 * Read village content and promotion labels.
 *
 * Content is found through the indexed `t` village topics (see contentTags.ts),
 * with the legacy multi-letter `#village` filter queried in parallel for older
 * content. When that legacy filter is unavailable (or nothing matched), it also
 * scans recent content so older posts keep appearing during the transition.
 */
export async function readVillageFeed(
  nostr: NPool, villages: string[], contentFilters: NostrFilter[], signal: AbortSignal,
) {
  const labels = { kinds: [1985], '#l': ['village-promoted'], limit: 100 };
  const matchesVillage = (event: NostrEvent) => {
    const tagged = villagesOf(event.tags);
    return tagged.length > 0 && (!villages.length || tagged.some(village => villages.includes(village)));
  };
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
  // Legacy content is only reachable through `#village`, which some relays reject and others
  // silently answer with nothing, and the all-villages feed has no legacy filter at all. Unless
  // the legacy query itself returned matches, scan recent content so posts from before the
  // indexed tags keep showing (new indexed posts must not hide them).
  const legacyMatched = legacy.status === 'fulfilled' && legacy.value.some(matchesVillage);
  if (!villages.length || !legacyMatched) {
    try {
      records = [...records, ...await nostr.query([...contentFilters, labels], { signal })];
    } catch (error) {
      signal.throwIfAborted();
      if (!records.length) throw error;
    }
  }

  const selected = records.filter(event => event.kind !== 1985 && matchesVillage(event));
  const kinds = new Set(contentFilters.flatMap(f => f.kinds ?? []));
  const references = new Set(records.filter(event =>
    event.kind === 1985 && (!villages.length || matchesVillage(event)))
    .flatMap(event => event.tags.filter(([name]) => name === 'a').map(([, address]) => address)));
  // One filter per kind+author keeps the REQ small (relays cap filters per subscription).
  const wanted = new Map<string, { kind: number; author: string; identifiers: Set<string> }>();
  const present = new Set(selected.map(coordinateOf));
  for (const address of references) {
    if (!address || present.has(address)) continue;
    const [kind, author, ...identifier] = address.split(':');
    if (kinds.has(Number(kind)) && /^[0-9a-f]{64}$/.test(author) && identifier.length) {
      const key = `${kind}:${author}`;
      const entry = wanted.get(key) ?? { kind: Number(kind), author, identifiers: new Set<string>() };
      entry.identifiers.add(identifier.join(':'));
      wanted.set(key, entry);
    }
  }
  const missing: NostrFilter[] = [...wanted.values()].map(({ kind, author, identifiers }) => ({
    kinds: [kind], authors: [author], '#d': [...identifiers], limit: identifiers.size,
  }));
  if (missing.length) {
    try {
      selected.push(...await nostr.query(missing, { signal }));
    } catch (error) {
      signal.throwIfAborted();
      if (!selected.length) throw error;
    }
  }
  // Results come from several requests: keep only the newest version of each address.
  const newest = new Map<string, NostrEvent>();
  for (const event of selected) {
    const key = coordinateOf(event);
    const current = newest.get(key);
    if (!current || event.created_at > current.created_at) newest.set(key, event);
  }
  return [...newest.values()];
}
