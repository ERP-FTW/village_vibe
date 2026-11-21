import type { NostrEvent } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { inboxRelaysFrom, supportsNip17, unwrapDirectMessage, type Rumor } from '@/lib/nip17';
import { readRelayUrls } from '@/lib/RelayPool';
import { useAppContext } from '@/hooks/useAppContext';

export interface DecryptedMessage {
  id: string;
  content: string;
  created_at: number;
  sender: string;
  recipient: string;
  isFromMe: boolean;
  decryptError?: boolean;
  /** 'nip17' for gift-wrapped messages, 'nip04' for legacy kind 4. */
  protocol: 'nip17' | 'nip04';
}

/** Decrypted NIP-04 content keyed by `${viewer}:${eventId}`; lives for the page session only. */
const plaintextCache = new Map<string, string>();
/** Opened NIP-17 gift wraps keyed by `${viewer}:${wrapId}` (null = not a valid message). */
const rumorCache = new Map<string, Rumor | null>();

/**
 * All NIP-17 messages addressed to the current user (including copies of their own sent
 * messages), opened from kind 1059 gift wraps. Each wrap is only opened once per session.
 */
export function useGiftWrappedInbox() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config, presetRelays } = useAppContext();
  const signer = user?.signer;

  return useQuery({
    queryKey: ['nip17-inbox', user?.pubkey, config.relayUrl],
    enabled: !!user && supportsNip17(signer),
    refetchInterval: 15000,
    queryFn: async ({ signal }): Promise<Rumor[]> => {
      if (!user || !supportsNip17(signer)) return [];
      // Messages are delivered to the user's advertised inbox relays (kind 10050) when they
      // have any, so read those in addition to the app's relays.
      const lists = await nostr.query([{ kinds: [10050], authors: [user.pubkey], limit: 1 }], { signal })
        .catch(() => [] as NostrEvent[]);
      const relays = [...new Set([
        ...(inboxRelaysFrom(lists).get(user.pubkey) ?? []),
        ...readRelayUrls(config.relayUrl, presetRelays),
      ])];
      const wraps = await nostr.query([{ kinds: [1059], '#p': [user.pubkey], limit: 300 }], { signal, relays });
      const rumors = await Promise.all(wraps.map(async (wrap) => {
        const key = `${user.pubkey}:${wrap.id}`;
        if (rumorCache.has(key)) return rumorCache.get(key) ?? null;
        const rumor = await unwrapDirectMessage(signer, wrap);
        rumorCache.set(key, rumor);
        return rumor;
      }));
      // The same rumor can arrive in several wraps (e.g. re-sent); keep one.
      return [...new Map(rumors.filter((r): r is Rumor => !!r).map(r => [r.id, r])).values()];
    },
  });
}

/** The other participant of a one-to-one NIP-17 message, or undefined for group messages. */
function partnerOf(rumor: Rumor, me: string): string | undefined {
  const recipients = rumor.tags.filter(([name]) => name === 'p').map(([, value]) => value);
  if (rumor.pubkey === me) return recipients.length === 1 ? recipients[0] : undefined;
  return recipients.length === 1 && recipients[0] === me ? rumor.pubkey : undefined;
}

export function useDirectMessages(otherUserPubkey?: string) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const inbox = useGiftWrappedInbox();

  const legacy = useQuery({
    queryKey: ['direct-messages', user?.pubkey, otherUserPubkey],
    queryFn: async (c): Promise<DecryptedMessage[]> => {
      if (!user?.pubkey || !otherUserPubkey) return [];

      // Legacy NIP-04 messages between the two users
      const events = await nostr.query([
        {
          kinds: [4],
          authors: [user.pubkey, otherUserPubkey],
          '#p': [user.pubkey, otherUserPubkey],
          limit: 100,
        }
      ], { signal: c.signal });

      // Messages between exactly these two users (incoming: we appear in any p tag)
      const relevantMessages = events.filter(event => {
        if (event.pubkey === user.pubkey) {
          return event.tags.find(([name]) => name === 'p')?.[1] === otherUserPubkey;
        }
        return event.pubkey === otherUserPubkey && event.tags.some(([name, value]) => name === 'p' && value === user.pubkey);
      });

      const nip04 = user.signer.nip04;
      return Promise.all(relevantMessages.map(async (event): Promise<DecryptedMessage> => {
        const message = {
          id: event.id,
          created_at: event.created_at,
          sender: event.pubkey,
          recipient: event.tags.find(([name]) => name === 'p')?.[1] || '',
          isFromMe: event.pubkey === user.pubkey,
          protocol: 'nip04' as const,
        };
        if (!nip04) {
          return { ...message, content: '[Decryption not supported by your signer]', decryptError: true };
        }
        // Polling re-reads the same events; decrypt each one only once per session
        // (each decrypt can be a signer prompt or a remote bunker round-trip).
        const cacheKey = `${user.pubkey}:${event.id}`;
        let plaintext = plaintextCache.get(cacheKey);
        if (plaintext === undefined) {
          try {
            plaintext = await nip04.decrypt(otherUserPubkey, event.content);
            plaintextCache.set(cacheKey, plaintext);
          } catch (error) {
            console.error('Failed to decrypt message:', error);
            return { ...message, content: '[Failed to decrypt message]', decryptError: true };
          }
        }
        return { ...message, content: plaintext };
      }));
    },
    enabled: !!user?.pubkey && !!otherUserPubkey,
    refetchInterval: 5000, // Refetch every 5 seconds for new messages
  });

  const me = user?.pubkey;
  const giftWrapped: DecryptedMessage[] = me && otherUserPubkey
    ? (inbox.data ?? [])
      .filter(rumor => partnerOf(rumor, me) === otherUserPubkey)
      .map(rumor => ({
        id: rumor.id,
        content: rumor.content,
        created_at: rumor.created_at,
        sender: rumor.pubkey,
        recipient: rumor.pubkey === me ? otherUserPubkey : me,
        isFromMe: rumor.pubkey === me,
        protocol: 'nip17' as const,
      }))
    : [];

  // Oldest first for chat display
  const data = legacy.data || inbox.data
    ? [...(legacy.data ?? []), ...giftWrapped].sort((a, b) => a.created_at - b.created_at)
    : undefined;

  return {
    data,
    isLoading: legacy.isLoading || (inbox.isLoading && inbox.fetchStatus !== 'idle'),
    error: legacy.error ?? inbox.error,
  };
}

// Hook to get all conversations (unique users the current user has messaged with)
export function useConversations() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const inbox = useGiftWrappedInbox();

  const legacy = useQuery({
    queryKey: ['conversations', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.pubkey) return [];

      // Legacy NIP-04 messages involving the current user
      const events = await nostr.query([
        { kinds: [4], authors: [user.pubkey], limit: 200 },
        { kinds: [4], '#p': [user.pubkey], limit: 200 },
      ], { signal: c.signal });

      // Latest message per conversation partner. Incoming messages count when we
      // appear in any p tag; outgoing ones belong to their first recipient.
      const latest = new Map<string, NostrEvent>();
      for (const event of events) {
        const partner = event.pubkey === user.pubkey
          ? event.tags.find(([name]) => name === 'p')?.[1]
          : event.tags.some(([name, value]) => name === 'p' && value === user.pubkey) ? event.pubkey : undefined;
        if (!partner) continue;
        const current = latest.get(partner);
        if (!current || event.created_at > current.created_at) latest.set(partner, event);
      }
      return Array.from(latest, ([pubkey, message]) => ({ pubkey, lastMessageAt: message.created_at }));
    },
    enabled: !!user?.pubkey,
    refetchInterval: 10000, // Refetch every 10 seconds for new conversations
  });

  // Merge legacy and NIP-17 conversations, keeping each partner's latest message time
  const latest = new Map<string, number>();
  for (const { pubkey, lastMessageAt } of legacy.data ?? []) latest.set(pubkey, lastMessageAt);
  if (user) {
    for (const rumor of inbox.data ?? []) {
      const partner = partnerOf(rumor, user.pubkey);
      if (partner && rumor.created_at > (latest.get(partner) ?? 0)) latest.set(partner, rumor.created_at);
    }
  }
  const data = legacy.data || inbox.data
    ? Array.from(latest, ([pubkey, lastMessageAt]) => ({ pubkey, lastMessageAt }))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    : undefined;

  return {
    data,
    isLoading: legacy.isLoading || (inbox.isLoading && inbox.fetchStatus !== 'idle'),
    error: legacy.error ?? inbox.error,
  };
}
