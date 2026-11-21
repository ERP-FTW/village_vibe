import { type NostrEvent, type NostrMetadata, type NStore, NSchema as n } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { batcherPerStore, createBatcher } from '@/lib/batcher';

/** Profile (kind 0) lookups from many components are merged into one request. */
const profileLoader = batcherPerStore((nostr: NStore) => createBatcher<string, NostrEvent>(async (pubkeys) => {
  const events = await nostr.query([{ kinds: [0], authors: pubkeys, limit: pubkeys.length }]);
  const newest = new Map<string, NostrEvent>();
  for (const event of events) {
    const current = newest.get(event.pubkey);
    if (!current || event.created_at > current.created_at) newest.set(event.pubkey, event);
  }
  return newest;
}));

export function useAuthor(pubkey: string | undefined) {
  const { nostr } = useNostr();

  return useQuery<{ event?: NostrEvent; metadata?: NostrMetadata }>({
    queryKey: ['author', pubkey ?? ''],
    queryFn: async () => {
      if (!pubkey) {
        return {};
      }

      const event = await profileLoader(nostr)(pubkey);

      if (!event) {
        return {};
      }

      try {
        const metadata = n.json().pipe(n.metadata()).parse(event.content);
        return { metadata, event };
      } catch {
        return { event };
      }
    },
  });
}
