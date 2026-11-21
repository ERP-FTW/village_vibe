import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCurrentUser } from './useCurrentUser';
import {
  deliverMissing, messageIdOf, newDelivery, prepareDirectMessage, type MessageDelivery,
} from '@/lib/dmDelivery';

/**
 * Messages sent in this page session, with their delivery state. Kept in memory only (the
 * query cache), never persisted: it holds the signed events needed to retry the missing part
 * of a delivery, and the plaintext so a sent message stays visible before relays return it.
 */
const outboxKey = (sender: string | undefined) => ['dm-outbox', sender] as const;

function recordDelivery(queryClient: QueryClient, sender: string, delivery: MessageDelivery) {
  const id = messageIdOf(delivery.prepared);
  queryClient.setQueryData<MessageDelivery[]>(outboxKey(sender), (current = []) => [
    ...current.filter(entry => messageIdOf(entry.prepared) !== id),
    delivery,
  ]);
}

function refreshMessages(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ['nip17-inbox'] });
  void queryClient.invalidateQueries({ queryKey: ['direct-messages'] });
  void queryClient.invalidateQueries({ queryKey: ['conversations'] });
}

const NO_DELIVERIES: MessageDelivery[] = [];

/** This session's sent messages (optionally only those to `partner`); stable between renders. */
export function useDmOutbox(partner?: string) {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { data = NO_DELIVERIES } = useQuery({
    queryKey: outboxKey(user?.pubkey),
    // Local state, not fetched: a refetch (e.g. after switching relays) keeps what's there.
    queryFn: () => queryClient.getQueryData<MessageDelivery[]>(outboxKey(user?.pubkey)) ?? NO_DELIVERIES,
    enabled: !!user,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return useMemo(
    () => partner ? data.filter(entry => entry.prepared.recipient === partner) : data,
    [data, partner],
  );
}

/**
 * Send a direct message. Resolves with what actually happened instead of throwing on a
 * partial failure:
 * - `recipient`: delivered (to their advertised NIP-17 inbox relays, or the app's relays when
 *   they advertise none) or failed. If their inbox lookup fails, nothing is sent.
 * - `senderCopy` (NIP-17): the copy that keeps the sender's own history, stored only after the
 *   recipient has the message. Null for NIP-04, where one event serves both sides.
 * Signers without NIP-44 fall back to NIP-04. It rejects only if the message couldn't be
 * encrypted or signed.
 */
export function useSendDirectMessage() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ recipient, message }: { recipient: string; message: string }): Promise<MessageDelivery> => {
      if (!user) throw new Error('You must be logged in to send messages.');
      const prepared = await prepareDirectMessage(user.signer, user.pubkey, recipient, message);
      const delivery = await deliverMissing(nostr, newDelivery(prepared));
      recordDelivery(queryClient, user.pubkey, delivery);
      return delivery;
    },
    onSettled: () => refreshMessages(queryClient),
  });
}

/** Retry only the parts of a delivery that failed, with the same signed events. */
export function useRetryDirectMessage() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (delivery: MessageDelivery): Promise<MessageDelivery> => {
      if (!user) throw new Error('You must be logged in to send messages.');
      const next = await deliverMissing(nostr, delivery);
      recordDelivery(queryClient, user.pubkey, next);
      return next;
    },
    onSettled: () => refreshMessages(queryClient),
  });
}
