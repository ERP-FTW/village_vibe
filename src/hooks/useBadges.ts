import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NStore } from '@nostrify/nostrify';
import { batcherPerStore, createBatcher } from '@/lib/batcher';

/** Badge award (kind 8) lookups for many users are merged into one request. */
const awardLoader = batcherPerStore((nostr: NStore) => createBatcher<string, NostrEvent[]>(async (pubkeys) => {
  const wanted = new Set(pubkeys);
  const awards = (await nostr.query([{ kinds: [8], '#p': pubkeys, limit: pubkeys.length * 20 }]))
    .filter(validateBadgeAward);
  const byUser = new Map<string, NostrEvent[]>(pubkeys.map(pubkey => [pubkey, []]));
  for (const award of awards) {
    for (const [name, pubkey] of award.tags) {
      if (name === 'p' && wanted.has(pubkey)) byUser.get(pubkey)?.push(award);
    }
  }
  return byUser;
}));

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