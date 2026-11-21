import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NStore } from '@nostrify/nostrify';
import { batcherPerStore, createBatcher } from '@/lib/batcher';

/**
 * Badge award (kind 8) lookups for many users are merged into one request, with a filter
 * per user so each keeps its own limit (one user's many awards cannot crowd out another's).
 * Users still without awards get one follow-up request, in case the combined request
 * completed before a slower relay answered for them.
 */
const awardLoader = batcherPerStore((nostr: NStore) => createBatcher<string, NostrEvent[]>(async (pubkeys) => {
  const byUser = new Map<string, NostrEvent[]>(pubkeys.map(pubkey => [pubkey, []]));
  const seen = new Set<string>();
  const collect = (awards: NostrEvent[]) => {
    for (const award of awards.filter(validateBadgeAward)) {
      if (seen.has(award.id)) continue;
      seen.add(award.id);
      for (const [name, pubkey] of award.tags) {
        if (name === 'p') byUser.get(pubkey)?.push(award);
      }
    }
  };
  const query = (keys: string[]) => nostr.query(keys.map(pubkey => ({ kinds: [8], '#p': [pubkey], limit: 100 })));
  collect(await query(pubkeys));
  const missing = pubkeys.filter(pubkey => !byUser.get(pubkey)?.length);
  if (missing.length && missing.length < pubkeys.length) collect(await query(missing).catch(() => []));
  return byUser;
}, { maxBatch: 20 }));

// Hook to get badge awards for a user
export function useUserBadgeAwards(userPubkey: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['user-badge-awards', userPubkey],
    queryFn: async () => (await awardLoader(nostr)(userPubkey)) ?? [],
    enabled: !!userPubkey,
  });
}

// Hook to get badges for a user (simplified version)
export function useBadges(userPubkey?: string) {
  const awards = useUserBadgeAwards(userPubkey || '');
  return useBadgeData(awards.data || []);
}

// Get combined badge data (definition + awards) for display
export function useBadgeData(badgeAwards: NostrEvent[]) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['badge-data', badgeAwards.map(e => e.id).join(',')],
    queryFn: async (c) => {
      if (badgeAwards.length === 0) return [];

      const { signal } = c;

      // Extract unique badge definition coordinates from awards
      const badgeCoords = Array.from(new Set(
        badgeAwards.map(award =>
          award.tags.find(([name]) => name === 'a')?.[1]
        ).filter(Boolean)
      ));

      if (badgeCoords.length === 0) return [];

      // Query for badge definitions
      const filters = badgeCoords.map(coord => {
        const [_kind, pubkey, dTag] = coord!.split(':');
        return {
          kinds: [30009],
          authors: [pubkey],
          '#d': [dTag],
        };
      });

      const definitions = await nostr.query(filters, { signal });

      // Combine definitions with awards
      return badgeAwards.map(award => {
        const aTag = award.tags.find(([name]) => name === 'a')?.[1];
        const definition = definitions.find(def => {
          const defCoord = `30009:${def.pubkey}:${def.tags.find(([name]) => name === 'd')?.[1]}`;
          return defCoord === aTag;
        });

        return {
          award,
          definition,
        };
      }).filter(item => item.definition);
    },
    enabled: badgeAwards.length > 0,
  });
}

// Validate badge definition structure
export function validateBadgeDefinition(event: NostrEvent): boolean {
  if (event.kind !== 30009) return false;

  const dTag = event.tags.find(([name]) => name === 'd')?.[1];
  if (!dTag) return false;

  return true;
}

// Validate badge award structure
export function validateBadgeAward(event: NostrEvent): boolean {
  if (event.kind !== 8) return false;

  const aTag = event.tags.find(([name]) => name === 'a')?.[1];
  const pTags = event.tags.filter(([name]) => name === 'p');

  if (!aTag || pTags.length === 0) return false;

  // NIP-58: an award is only valid when issued by the badge definition's author.
  // Without this check anyone could award themselves any tribe's badge.
  const [kind, issuer] = aTag.split(':');
  return kind === '30009' && issuer === event.pubkey;
}