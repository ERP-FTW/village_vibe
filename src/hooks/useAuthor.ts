import { type NostrEvent, type NostrMetadata, type NStore, NSchema as n } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { batcherPerStore, createBatcher } from '@/lib/batcher';

function newestByAuthor(events: NostrEvent[], into = new Map<string, NostrEvent>()): Map<string, NostrEvent> {
  for (const event of events) {
    const current = into.get(event.pubkey);
    if (!current || event.created_at > current.created_at) into.set(event.pubkey, event);
  }
  return into;
}

/**
 * Profile (kind 0) lookups from many components are merged into one request.
 *
 * A combined request can complete before slower relays answer for every author (the pool
 * returns shortly after the first relay with matches), so authors still missing get one
 * follow-up request of their own before being treated as having no profile.
 */
const profileLoader = batcherPerStore((nostr: NStore) => createBatcher<string, NostrEvent>(async (pubkeys) => {
  const found = newestByAuthor(await nostr.query([{ kinds: [0], authors: pubkeys, limit: pubkeys.length }]));
  const missing = pubkeys.filter(pubkey => !found.has(pubkey));
  if (missing.length && missing.length < pubkeys.length) {
    newestByAuthor(await nostr.query([{ kinds: [0], authors: missing, limit: missing.length }]).catch(() => []), found);
  }
  return found;
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
