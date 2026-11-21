import { useNostr } from '@nostrify/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { supportsNip17, wrapDirectMessage } from '@/lib/nip17';

/** Inbox relays a user advertises for NIP-17 messages (kind 10050), by pubkey. */
async function inboxRelays(nostr: ReturnType<typeof useNostr>['nostr'], pubkeys: string[]): Promise<Map<string, string[]>> {
  const lists = await nostr.query([{ kinds: [10050], authors: pubkeys, limit: pubkeys.length }], {
    signal: AbortSignal.timeout(3000),
  }).catch(() => [] as NostrEvent[]);
  return new Map(lists.map(list => [
    list.pubkey,
    list.tags.filter(([name, url]) => name === 'relay' && url?.startsWith('wss://')).map(([, url]) => url).slice(0, 5),
  ]));
}

/** Resolve when any promise resolves; reject only if all reject. */
function firstSuccess(promises: Promise<unknown>[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let failures = 0;
    for (const promise of promises) {
      promise.then(() => resolve(), (error) => { if (++failures === promises.length) reject(error); });
    }
  });
}

/**
 * Send a direct message.
 *
 * With a NIP-44 capable signer this sends a NIP-17 gift-wrapped message (sender and
 * timing hidden from relays) to the recipient's inbox relays plus the app's relays, and a
 * copy to the sender's own inbox. Otherwise it falls back to a NIP-04 (kind 4) message.
 * Resolves only once a relay accepted the recipient's copy.
 */
export function useSendDirectMessage() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: publish } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ recipient, message }: { recipient: string; message: string }) => {
      if (!user) throw new Error('You must be logged in to send messages.');
      const signer = user.signer;

      if (supportsNip17(signer)) {
        const { recipientWrap, senderWrap } = await wrapDirectMessage(signer, user.pubkey, recipient, message);
        const relays = await inboxRelays(nostr, [recipient, user.pubkey]);
        const send = (wrap: NostrEvent, owner: string) => firstSuccess([
          nostr.event(wrap, { signal: AbortSignal.timeout(5000) }),
          ...(relays.get(owner)?.length
            ? [nostr.event(wrap, { relays: relays.get(owner), signal: AbortSignal.timeout(5000) })]
            : []),
        ]);
        await send(recipientWrap, recipient);
        // The sender's copy only affects this user's own history; don't fail the send over it.
        await send(senderWrap, user.pubkey).catch(() => undefined);
        return { protocol: 'nip17' as const };
      }

      if (!signer.nip04) throw new Error('Your signer does not support encrypted messages.');
      const content = await signer.nip04.encrypt(recipient, message);
      await publish({ kind: 4, content, tags: [['p', recipient]] });
      return { protocol: 'nip04' as const };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['nip17-inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['direct-messages'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}
