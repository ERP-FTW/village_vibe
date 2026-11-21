import type { NostrEvent, NostrFilter, NPool } from '@nostrify/nostrify';

/** Read existing village tags and promotion labels without changing the wire format. */
export async function readVillageFeed(
  nostr: NPool, villages: string[], contentFilters: NostrFilter[], signal: AbortSignal,
) {
  const labels = { kinds: [1985], '#l': ['village-promoted'], limit: 100 };
  const matchesVillage = (event: NostrEvent) => event.tags.some(
    ([name, value]) => name === 'village' && (!villages.length || villages.includes(value)),
  );
  let records: NostrEvent[] = [];
  if (villages.length) {
    try {
      records = await nostr.query([...contentFilters.map(f => ({ ...f, '#village': villages })), labels], { signal });
    } catch {
      signal.throwIfAborted(); // Relays may reject the legacy multi-letter filter.
    }
  }
  if (!records.some(event => event.kind !== 1985 && matchesVillage(event))) {
    records = await nostr.query([...contentFilters, labels], { signal });
  }

  const selected = records.filter(event => event.kind !== 1985 && matchesVillage(event));
  const kinds = new Set(contentFilters.flatMap(f => f.kinds ?? []));
  const references = new Set(records.filter(event =>
    event.kind === 1985 && (!villages.length || matchesVillage(event)))
    .flatMap(event => event.tags.filter(([name]) => name === 'a').map(([, address]) => address)));
  // One filter per kind+author keeps the REQ small (relays cap filters per subscription).
  const wanted = new Map<string, { kind: number; author: string; identifiers: Set<string> }>();
  const present = new Set(selected.map(event =>
    `${event.kind}:${event.pubkey}:${event.tags.find(([name]) => name === 'd')?.[1] ?? ''}`));
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
  return Array.from(new Map(selected.map(event => [event.id, event])).values());
}
