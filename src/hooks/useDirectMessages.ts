import type { NostrEvent } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { inboxRelaysFrom, SignerUnavailableError, supportsNip17, unwrapDirectMessage, type Rumor } from '@/lib/nip17';
import { readRelayUrls } from '@/lib/RelayPool';
import { describeHistoryGaps, historyComplete, MAX_RECENT_PAGES, mergeCursors, readOlderWraps, readRecentWraps, RECENT_PAGES_CAP, type RelayCursor } from '@/lib/inboxPaging';
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
/** Wraps the signer failed to open (declined, disconnected), with when to try again. */
const retryAfter = new Map<string, number>();
const SIGNER_RETRY_MS = 5 * 60 * 1000;
/**
 * Older history loaded on request ("Load older messages"), per viewer, for the page session.
 * The regular refresh re-reads only the recent window, so these wraps and the cursors to
 * continue from are kept here.
 */
const olderHistory = new Map<string, { wraps: Map<string, NostrEvent>; cursors: RelayCursor[] }>();
/**
 * Every wrap read for a viewer this session. Messages aren't withdrawn, so a refresh that
 * can't reach some (or all) relays keeps showing what was already read instead of dropping it.
 */
const knownWraps = new Map<string, Map<string, NostrEvent>>();
/** Per viewer: pages read per relay when refreshing the recent window (raised on request). */
const recentPageBudget = new Map<string, number>();

/** What the inbox could and couldn't read, for display. */
export interface InboxHistory {
  /** Every relay was read to the end of its history with nothing skipped. */
  complete: boolean;
  /** Older messages may exist on some relay: "load older" can read further. */
  canLoadOlder: boolean;
  notes: string[];
}

export interface GiftWrappedInbox {
  rumors: Rumor[];
  cursors: RelayCursor[];
  history: InboxHistory;
}

function inboxHistory(cursors: RelayCursor[], inboxListError?: string, budget = MAX_RECENT_PAGES): InboxHistory {
  const notes = describeHistoryGaps(cursors);
  if (inboxListError) notes.unshift(`Couldn't look up your inbox relays (${inboxListError}); messages delivered only there may be missing.`);
  const deeper = (cursor: RelayCursor) => cursor.gap === 'page-limit' ? budget < RECENT_PAGES_CAP : cursor.nextUntil !== undefined;
  return {
    complete: historyComplete(cursors) && !inboxListError,
    canLoadOlder: cursors.some(cursor => cursor.gap === 'error' || deeper(cursor)),
    notes,
  };
}

async function openWraps(signer: Parameters<typeof unwrapDirectMessage>[0], viewer: string, wraps: NostrEvent[]): Promise<Rumor[]> {
  const rumors = await Promise.all(wraps.map(async (wrap) => {
    const key = `${viewer}:${wrap.id}`;
    if (rumorCache.has(key)) return rumorCache.get(key) ?? null;
    if ((retryAfter.get(key) ?? 0) > Date.now()) return null;
    try {
      const rumor = await unwrapDirectMessage(signer, wrap);
      rumorCache.set(key, rumor);
      retryAfter.delete(key);
      return rumor;
    } catch (error) {
      // The signer failed (declined, disconnected): try this wrap again later
      if (error instanceof SignerUnavailableError) retryAfter.set(key, Date.now() + SIGNER_RETRY_MS);
      return null;
    }
  }));
  // The same rumor can arrive in several wraps (e.g. re-sent); keep one.
  return [...new Map(rumors.filter((r): r is Rumor => !!r).map(r => [r.id, r])).values()];
}

/**
 * All NIP-17 messages addressed to the current user (including copies of their own sent
 * messages), opened from kind 1059 gift wraps, with what may be missing. Each wrap is only
 * opened once per session. Relays that fail keep the pages they returned.
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
    queryFn: async ({ signal }): Promise<GiftWrappedInbox> => {
      if (!user || !signer || !supportsNip17(signer)) return { rumors: [], cursors: [], history: inboxHistory([]) };
      // Messages are delivered to the user's advertised inbox relays (kind 10050) when they
      // have any, so read those in addition to the app's relays.
      let inboxListError: string | undefined;
      const lists = await nostr.query([{ kinds: [10050], authors: [user.pubkey], limit: 1 }], { signal })
        .catch((error: unknown) => {
          signal.throwIfAborted();
          inboxListError = error instanceof Error ? error.message : String(error);
          return [] as NostrEvent[];
        });
      const relays = [...new Set([
        ...(inboxRelaysFrom(lists).get(user.pubkey) ?? []),
        ...readRelayUrls(config.relayUrl, presetRelays),
      ])];
      const budget = recentPageBudget.get(user.pubkey) ?? MAX_RECENT_PAGES;
      const recent = await readRecentWraps(nostr, user.pubkey, relays, { signal, maxPages: budget });
      const older = olderHistory.get(user.pubkey);
      const cursors = mergeCursors(recent.cursors, older?.cursors);
      const known = knownWraps.get(user.pubkey) ?? new Map<string, NostrEvent>();
      for (const wrap of [...recent.wraps, ...(older?.wraps.values() ?? [])]) known.set(wrap.id, wrap);
      knownWraps.set(user.pubkey, known);
      const rumors = await openWraps(signer, user.pubkey, [...known.values()]);
      return { rumors, cursors, history: inboxHistory(cursors, inboxListError, budget) };
    },
  });
}

/** Reads one more page of older messages from each relay that has some left, then refreshes. */
export function useLoadOlderMessages() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (cursors: RelayCursor[]) => {
      if (!user) return;
      // A recent window that wasn't read in full: read more of it on each refresh (bounded)
      if (cursors.some(cursor => cursor.gap === 'page-limit')) {
        const budget = recentPageBudget.get(user.pubkey) ?? MAX_RECENT_PAGES;
        recentPageBudget.set(user.pubkey, Math.min(budget + MAX_RECENT_PAGES, RECENT_PAGES_CAP));
      }
      // Older history beyond the window, for relays whose window is complete
      const beyond = cursors.filter(cursor => cursor.gap !== 'page-limit');
      const stored = olderHistory.get(user.pubkey) ?? { wraps: new Map<string, NostrEvent>(), cursors: [] };
      const read = await readOlderWraps(nostr, user.pubkey, beyond, stored.wraps.keys());
      read.wraps.forEach(wrap => stored.wraps.set(wrap.id, wrap));
      olderHistory.set(user.pubkey, {
        wraps: stored.wraps,
        cursors: [...stored.cursors.filter(c => !read.cursors.some(r => r.relay === c.relay)), ...read.cursors],
      });
    },
    // Also re-reads the recent window, which retries relays that failed
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['nip17-inbox'] }),
  });
}

/** The other participant of a one-to-one NIP-17 message, or undefined for group messages. */
function partnerOf(rumor: Rumor, me: string): string | undefined {
  const recipients = rumor.tags.filter(([name]) => name === 'p').map(([, value]) => value);
  if (rumor.pubkey === me) return recipients.length === 1 ? recipients[0] : undefined;
  return recipients.length === 1 && recipients[0] === me ? rumor.pubkey : undefined;
}

const LEGACY_DM_LIMIT = 100;
const LEGACY_CONVERSATION_LIMIT = 200;

/** NIP-17 and NIP-04 history status together; each protocol's messages show if the other fails. */
function combineHistory(inbox: InboxHistory | undefined, legacyError: Error | null, legacyCapped: boolean | undefined, cappedNote: string): InboxHistory {
  const notes = [...(inbox?.notes ?? [])];
  if (legacyError) notes.push(`Couldn't load older-format (NIP-04) messages (${legacyError.message}).`);
  if (legacyCapped) notes.push(cappedNote);
  return {
    complete: (inbox?.complete ?? true) && !legacyError && !legacyCapped,
    canLoadOlder: inbox?.canLoadOlder ?? false,
    notes,
  };
}

export function useDirectMessages(otherUserPubkey?: string) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const inbox = useGiftWrappedInbox();

  const legacy = useQuery({
    queryKey: ['direct-messages', user?.pubkey, otherUserPubkey],
    queryFn: async (c): Promise<{ messages: DecryptedMessage[]; capped: boolean }> => {
      if (!user?.pubkey || !otherUserPubkey) return { messages: [], capped: false };

      // Legacy NIP-04 messages between the two users
      const events = await nostr.query([
        {
          kinds: [4],
          authors: [user.pubkey, otherUserPubkey],
          '#p': [user.pubkey, otherUserPubkey],
          limit: LEGACY_DM_LIMIT,
        }
      ], { signal: c.signal });
      // A full page means older NIP-04 messages may exist beyond it
      const capped = events.length >= LEGACY_DM_LIMIT;

      // Messages between exactly these two users (incoming: we appear in any p tag)
      const relevantMessages = events.filter(event => {
        if (event.pubkey === user.pubkey) {
          return event.tags.find(([name]) => name === 'p')?.[1] === otherUserPubkey;
        }
        return event.pubkey === otherUserPubkey && event.tags.some(([name, value]) => name === 'p' && value === user.pubkey);
      });

      const nip04 = user.signer.nip04;
      const messages = await Promise.all(relevantMessages.map(async (event): Promise<DecryptedMessage> => {
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
      return { messages, capped };
    },
    enabled: !!user?.pubkey && !!otherUserPubkey,
    refetchInterval: 5000, // Refetch every 5 seconds for new messages
  });

  const me = user?.pubkey;
  // Merged only when either source changes: a new array on every render would retrigger
  // effects that depend on the message list (e.g. scrolling to the newest message).
  const data = useMemo(() => {
    if (!legacy.data && !inbox.data) return undefined;
    const giftWrapped: DecryptedMessage[] = me && otherUserPubkey
      ? (inbox.data?.rumors ?? [])
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
    return [...(legacy.data?.messages ?? []), ...giftWrapped].sort((a, b) => a.created_at - b.created_at);
  }, [legacy.data, inbox.data, me, otherUserPubkey]);

  const { mutate: loadOlderMutate, isPending: isLoadingOlder } = useLoadOlderMessages();
  const history = useMemo(
    () => combineHistory(inbox.data?.history, legacy.error, legacy.data?.capped, 'Only the latest 100 older-format (NIP-04) messages with this person are loaded.'),
    [inbox.data?.history, legacy.error, legacy.data?.capped],
  );

  return {
    data,
    isLoading: legacy.isLoading || (inbox.isLoading && inbox.fetchStatus !== 'idle'),
    error: legacy.error ?? inbox.error,
    history,
    loadOlder: () => loadOlderMutate(inbox.data?.cursors ?? []),
    isLoadingOlder,
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
      if (!user?.pubkey) return { conversations: [], capped: false };

      // Legacy NIP-04 messages involving the current user
      const events = await nostr.query([
        { kinds: [4], authors: [user.pubkey], limit: LEGACY_CONVERSATION_LIMIT },
        { kinds: [4], '#p': [user.pubkey], limit: LEGACY_CONVERSATION_LIMIT },
      ], { signal: c.signal });
      const sent = events.filter(event => event.pubkey === user.pubkey).length;
      const capped = sent >= LEGACY_CONVERSATION_LIMIT || events.length - sent >= LEGACY_CONVERSATION_LIMIT;

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
      return { conversations: Array.from(latest, ([pubkey, message]) => ({ pubkey, lastMessageAt: message.created_at })), capped };
    },
    enabled: !!user?.pubkey,
    refetchInterval: 10000, // Refetch every 10 seconds for new conversations
  });

  // Merge legacy and NIP-17 conversations, keeping each partner's latest message time
  const me = user?.pubkey;
  const data = useMemo(() => {
    if (!legacy.data && !inbox.data) return undefined;
    const latest = new Map<string, number>();
    for (const { pubkey, lastMessageAt } of legacy.data?.conversations ?? []) latest.set(pubkey, lastMessageAt);
    if (me) {
      for (const rumor of inbox.data?.rumors ?? []) {
        const partner = partnerOf(rumor, me);
        if (partner && rumor.created_at > (latest.get(partner) ?? 0)) latest.set(partner, rumor.created_at);
      }
    }
    return Array.from(latest, ([pubkey, lastMessageAt]) => ({ pubkey, lastMessageAt }))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }, [legacy.data, inbox.data, me]);

  const { mutate: loadOlderMutate, isPending: isLoadingOlder } = useLoadOlderMessages();
  const history = useMemo(
    () => combineHistory(inbox.data?.history, legacy.error, legacy.data?.capped, 'Only conversations from your latest 200 sent and received older-format (NIP-04) messages are listed.'),
    [inbox.data?.history, legacy.error, legacy.data?.capped],
  );

  return {
    data,
    isLoading: legacy.isLoading || (inbox.isLoading && inbox.fetchStatus !== 'idle'),
    error: legacy.error ?? inbox.error,
    history,
    loadOlder: () => loadOlderMutate(inbox.data?.cursors ?? []),
    isLoadingOlder,
  };
}
