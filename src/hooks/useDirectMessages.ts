import type { NostrEvent } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export interface DecryptedMessage {
  id: string;
  content: string;
  created_at: number;
  sender: string;
  recipient: string;
  isFromMe: boolean;
  decryptError?: boolean;
}

/** Decrypted DM content keyed by `${viewer}:${eventId}`; lives for the page session only. */
const plaintextCache = new Map<string, string>();

export function useDirectMessages(otherUserPubkey?: string) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ['direct-messages', user?.pubkey, otherUserPubkey],
    queryFn: async (c) => {
      if (!user?.pubkey || !otherUserPubkey) return [];

      const { signal } = c;

      // Query for DMs between the two users
      const events = await nostr.query([
        {
          kinds: [4], // Encrypted Direct Messages
          authors: [user.pubkey, otherUserPubkey],
          '#p': [user.pubkey, otherUserPubkey],
          limit: 100,
        }
      ], { signal });

      // Messages between exactly these two users (incoming: we appear in any p tag)
      const relevantMessages = events.filter(event => {
        if (event.pubkey === user.pubkey) {
          return event.tags.find(([name]) => name === 'p')?.[1] === otherUserPubkey;
        }
        return event.pubkey === otherUserPubkey && event.tags.some(([name, value]) => name === 'p' && value === user.pubkey);
      });

      const nip04 = user.signer.nip04;
      const decryptedMessages = await Promise.all(relevantMessages.map(async (event): Promise<DecryptedMessage> => {
        const message = {
          id: event.id,
          created_at: event.created_at,
          sender: event.pubkey,
          recipient: event.tags.find(([name]) => name === 'p')?.[1] || '',
          isFromMe: event.pubkey === user.pubkey,
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

      // Sort by timestamp (oldest first for chat display)
      return decryptedMessages.sort((a, b) => a.created_at - b.created_at);
    },
    enabled: !!user?.pubkey && !!otherUserPubkey,
    refetchInterval: 5000, // Refetch every 5 seconds for new messages
  });
}

// Hook to get all conversations (unique users the current user has messaged with)
export function useConversations() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ['conversations', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.pubkey) return [];

      const { signal } = c;

      // Get all DMs involving the current user
      const events = await nostr.query([
        {
          kinds: [4],
          authors: [user.pubkey],
          limit: 200,
        },
        {
          kinds: [4],
          '#p': [user.pubkey],
          limit: 200,
        }
      ], { signal });

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

      const conversations = Array.from(latest, ([pubkey, message]) => ({
        pubkey,
        lastMessageAt: message.created_at,
        lastMessageId: message.id,
      }));

      // Sort by most recent message
      return conversations.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    },
    enabled: !!user?.pubkey,
    refetchInterval: 10000, // Refetch every 10 seconds for new conversations
  });
}