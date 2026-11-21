import { useNostr } from '@nostrify/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { inboxRelaysFrom, supportsNip17, wrapDirectMessage } from '@/lib/nip17';

/**
 * Send a direct message.
 *
 * With a NIP-44 capable signer this sends a NIP-17 gift-wrapped message (sender and timing
 * hidden from relays). Per NIP-17, each copy goes only to its owner's advertised inbox
 * relays (kind 10050) when they have any, and delivery means one of those relays accepted
 * it; users without an inbox list get the copy on the app's relays. The sender keeps a
 * copy in their own inbox. Signers without NIP-44 fall back to NIP-04 (kind 4).
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
        const lists = await nostr.query(
          [{ kinds: [10050], authors: [recipient, user.pubkey], limit: 2 }],
          { signal: AbortSignal.timeout(4000) },
        ).catch(() => [] as NostrEvent[]);
        const inboxes = inboxRelaysFrom(lists);
        const deliver = (wrap: NostrEvent, owner: string) => {
          const relays = inboxes.get(owner);
          return nostr.event(wrap, { signal: AbortSignal.timeout(6000), ...(relays?.length ? { relays } : {}) });
        };
        await deliver(recipientWrap, recipient);
        // The sender's copy only affects this user's own history; don't fail the send over it.
        await deliver(senderWrap, user.pubkey).catch(() => undefined);
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
