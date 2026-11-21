import type { NostrEvent, NPool } from '@nostrify/nostrify';

/** Addressable coordinate (`kind:pubkey:d`) of an event. */
export function coordinateOf(event: NostrEvent): string {
  return `${event.kind}:${event.pubkey}:${event.tags.find(([name]) => name === 'd')?.[1] ?? ''}`;
}

/**
 * Remove content that the tribe's moderators labelled `tribe-hidden` (NIP-32, kind 1985).
 *
 * Labels are fetched in a second request scoped to the displayed coordinates, so the
 * lookup is complete for this content (no global label limit) and a relay that only has
 * labels cannot end the content read early. Labels from non-moderators are ignored.
 */
export async function dropHidden(
  nostr: NPool, content: NostrEvent[], moderators: string[], signal: AbortSignal,
): Promise<NostrEvent[]> {
  if (!content.length || !moderators.length) return content;
  const coordinates = [...new Set(content.map(coordinateOf))];
  const labels = await nostr.query([{
    kinds: [1985],
    authors: moderators,
    '#l': ['tribe-hidden'],
    '#a': coordinates,
    limit: coordinates.length * Math.min(moderators.length, 5) + 50,
  }], { signal });
  const trusted = new Set(moderators);
  const hidden = new Set(labels
    .filter(label => trusted.has(label.pubkey) && label.tags.some(([name, value]) => name === 'l' && value === 'tribe-hidden'))
    .flatMap(label => label.tags.filter(([name]) => name === 'a').map(([, address]) => address)));
  return content.filter(event => !hidden.has(coordinateOf(event)));
}
