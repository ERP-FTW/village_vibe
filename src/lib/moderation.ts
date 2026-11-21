import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

/** NIP-32 labels (kind 1985) by the given moderators that hide content from a tribe feed. */
export function tribeHiddenLabelsFilter(moderators: string[]): NostrFilter {
  return { kinds: [1985], authors: moderators, '#l': ['tribe-hidden'], limit: 500 };
}

/** Addressable coordinate (`kind:pubkey:d`) of an event. */
export function coordinateOf(event: NostrEvent): string {
  return `${event.kind}:${event.pubkey}:${event.tags.find(([name]) => name === 'd')?.[1] ?? ''}`;
}

/**
 * Split a combined query result into content and the set of coordinates hidden by
 * the tribe's moderators. Labels from anyone else are ignored.
 */
export function withoutHidden(records: NostrEvent[], moderators: string[]): NostrEvent[] {
  const trusted = new Set(moderators);
  const hidden = new Set(records
    .filter(event => event.kind === 1985 && trusted.has(event.pubkey)
      && event.tags.some(([name, value]) => name === 'l' && value === 'tribe-hidden'))
    .flatMap(event => event.tags.filter(([name]) => name === 'a').map(([, address]) => address)));
  return records.filter(event => event.kind !== 1985 && !hidden.has(coordinateOf(event)));
}
