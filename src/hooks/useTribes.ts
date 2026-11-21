import { useNostr } from '@nostrify/react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { NostrEvent, NStore } from '@nostrify/nostrify';
import { tribeIdOf, tribeModerators } from '@/lib/tribes';

export type TribeRequestStatus = 'none' | 'pending' | 'rejected';

export interface TribeCardStatus {
  tribeId: string;
  requestStatus: TribeRequestStatus;
}

// Hook to get tribes (communities) that the user belongs to
export function useMyTribes(pubkey?: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['my-tribes', pubkey],
    queryFn: async (c) => {
      if (!pubkey) return [];

      const { signal } = c;

      // Query for community definitions where user is a moderator/member
      const events = await nostr.query([
        {
          kinds: [34550], // Community Definition (NIP-72)
          '#p': [pubkey],
          limit: 50,
        }
      ], { signal });

      return events;
    },
    enabled: !!pubkey,
  });
}

// Hook to get all public tribes
export function usePublicTribes() {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['public-tribes'],
    queryFn: async (c) => {
      const { signal } = c;

      const events = await nostr.query([
        {
          kinds: [34550], // Community Definition (NIP-72)
          '#t': ['tribe'], // Filter for tribe communities
          limit: 50,
        }
      ], { signal });

      // Private tribes are only discoverable by their members.
      return events.filter(event => validateTribeEvent(event) && !event.tags.some(([name]) => name === 'private'));
    },
  });
}

/** Shared query definition so feeds can reuse the cached tribe definition. */
export function tribeQueryOptions(nostr: NStore, tribeId: string) {
  return queryOptions({
    queryKey: ['tribe', tribeId],
    queryFn: async ({ signal }): Promise<NostrEvent | null> => {
      const [pubkey, ...parts] = tribeId.split(':');
      const identifier = parts.join(':');
      if (!/^[0-9a-f]{64}$/.test(pubkey) || !identifier) return null;
      const [tribe] = await nostr.query([{
        kinds: [34550], authors: [pubkey], '#d': [identifier], limit: 1,
      }], { signal });
      return tribe ?? null;
    },
  });
}

// Hook to get a specific tribe by its coordinates
export function useTribe(tribeId: string) {
  const { nostr } = useNostr();
  return useQuery({ ...tribeQueryOptions(nostr, tribeId), enabled: tribeId.includes(':') });
}

// Hook to get tribe name from tribe tag value
export function useTribeName(tribeTag?: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['tribe-name', tribeTag],
    queryFn: async (c) => {
      if (!tribeTag) return null;

      const { signal } = c;

      // Query for community definitions with this d tag
      const events = await nostr.query([
        {
          kinds: [34550], // Community Definition (NIP-72)
          '#d': [tribeTag],
          limit: 10,
        }
      ], { signal });

      if (events.length === 0) return null;

      // Return the first valid tribe event
      const tribe = events.find(validateTribeEvent);
      if (!tribe) return null;

      // Extract tribe name
      const name = tribe.tags.find(([name]) => name === 'name')?.[1] || tribeTag;
      return {
        name,
        tribe,
      };
    },
    enabled: !!tribeTag,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}

/**
 * Batch-query join-request and rejection status for multiple tribe IDs.
 * Returns a Map<tribeId, TribeRequestStatus> so each TribeCard can read
 * its status without firing any individual queries of its own.
 */
export function useTribesCardStatuses(tribes: NostrEvent[], userPubkey?: string) {
  const { nostr } = useNostr();
  const tribeIds = [...new Set(tribes.map(tribeIdOf))].sort();

  return useQuery({
    queryKey: ['tribes-card-statuses', tribeIds.join(','), userPubkey],
    queryFn: async (c) => {
      const result = new Map<string, TribeRequestStatus>();
      tribeIds.forEach(id => result.set(id, 'none'));

      if (!userPubkey || tribeIds.length === 0) return result;

      // Only the tribe's own moderators can reject a request.
      const moderators = new Map(tribes.map(tribe => [tribeIdOf(tribe), new Set(tribeModerators(tribe))]));

      // One request for both join requests (9021) and rejections (9022)
      const events = await nostr.query(
        [
          {
            kinds: [9021], // join requests authored by user
            authors: [userPubkey],
            '#h': tribeIds,
            limit: 200,
          },
          {
            kinds: [9022], // rejections targeting user
            '#p': [userPubkey],
            '#h': tribeIds,
            limit: 200,
          },
        ],
        { signal: c.signal },
      );

      // Mark rejections first (highest priority)
      events.filter(e => e.kind === 9022).forEach(e => {
        const h = e.tags.find(([n]) => n === 'h')?.[1];
        if (h && result.has(h) && moderators.get(h)?.has(e.pubkey)) result.set(h, 'rejected');
      });

      // Mark pending only if not already rejected
      events.filter(e => e.kind === 9021).forEach(e => {
        const h = e.tags.find(([n]) => n === 'h')?.[1];
        if (h && result.get(h) === 'none') result.set(h, 'pending');
      });

      return result;
    },
    enabled: tribeIds.length > 0,
  });
}

// Validate tribe event structure
export function validateTribeEvent(event: NostrEvent): boolean {
  if (event.kind !== 34550) return false;

  const dTag = event.tags.find(([name]) => name === 'd')?.[1];
  const _nameTag = event.tags.find(([name]) => name === 'name')?.[1];

  // Must have d tag and either name tag or use d tag as name
  if (!dTag) return false;

  return true;
}