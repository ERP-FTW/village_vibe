import type { NostrEvent, NostrFilter, NostrSigner } from '@nostrify/nostrify';
import { inboxRelaysFrom, supportsNip17, wrapDirectMessage, type Rumor } from '@/lib/nip17';

/** The relay operations delivery needs (the app's relay pool satisfies this). */
export interface DeliveryRelays {
  query(filters: NostrFilter[], opts?: { signal?: AbortSignal; relays?: string[] }): Promise<NostrEvent[]>;
  event(event: NostrEvent, opts?: { signal?: AbortSignal; relays?: string[] }): Promise<void>;
}

/** Where someone receives NIP-17 messages, as far as a lookup could tell. */
export type InboxLookup =
  | { status: 'found'; relays: string[] }
  /** The lookup worked and the person advertises no inbox relays: use the app's relays. */
  | { status: 'none' }
  /** The lookup itself failed: we don't know where to deliver, so nothing is sent. */
  | { status: 'failed'; error: string };

export type PartOutcome =
  | { status: 'pending' }
  | { status: 'delivered'; via: 'inbox' | 'app-relays' }
  | { status: 'failed'; error: string };

/** A signed message, kept (in memory only) so a retry re-sends exactly the same events. */
export type PreparedMessage =
  | { protocol: 'nip17'; sender: string; recipient: string; rumor: Rumor; recipientWrap: NostrEvent; senderWrap: NostrEvent }
  | { protocol: 'nip04'; sender: string; recipient: string; text: string; event: NostrEvent };

export interface MessageDelivery {
  prepared: PreparedMessage;
  /** Delivery to the recipient. */
  recipient: PartOutcome;
  /** NIP-17 only: the copy in the sender's own inbox that keeps their history (null for NIP-04). */
  senderCopy: PartOutcome | null;
}

const PUBLISH_TIMEOUT_MS = 6000;

export function messageIdOf(prepared: PreparedMessage): string {
  return prepared.protocol === 'nip17' ? prepared.rumor.id : prepared.event.id;
}

export function messageTextOf(prepared: PreparedMessage): string {
  return prepared.protocol === 'nip17' ? prepared.rumor.content : prepared.text;
}

export function messageTimeOf(prepared: PreparedMessage): number {
  return prepared.protocol === 'nip17' ? prepared.rumor.created_at : prepared.event.created_at;
}

export function isDeliveryComplete(delivery: MessageDelivery): boolean {
  return delivery.recipient.status === 'delivered' && (delivery.senderCopy === null || delivery.senderCopy.status === 'delivered');
}

function describeError(error: unknown): string {
  // Promise.any's AggregateError (from publishing to several relays)
  if (error && typeof error === 'object' && 'errors' in error && Array.isArray(error.errors)) {
    return describeError(error.errors[0] ?? 'every relay rejected it');
  }
  // A relay connection reports the publish timeout as a plain abort ("The signal has been
  // aborted"). The only signal a delivery passes is that timeout, so both mean the same.
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'timed out';
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/**
 * Successful lookups per relay pool, reused briefly so a batch (e.g. invitations, which all
 * need the organizer's inbox) costs one request. Failed lookups are not kept, so a retry
 * looks again.
 */
const lookupCache = new WeakMap<DeliveryRelays, Map<string, { at: number; lookup: Promise<InboxLookup> }>>();
const LOOKUP_TTL_MS = 2 * 60 * 1000;

/**
 * Inbox lookups for `pubkeys`: cached or in-flight ones are reused and the rest are looked
 * up together in one request.
 */
export async function lookupInboxesCached(nostr: DeliveryRelays, pubkeys: string[]): Promise<Map<string, InboxLookup>> {
  let cache = lookupCache.get(nostr);
  if (!cache) lookupCache.set(nostr, cache = new Map());
  const now = Date.now();
  const missing = [...new Set(pubkeys)].filter(pubkey => {
    const entry = cache!.get(pubkey);
    return !entry || now - entry.at > LOOKUP_TTL_MS;
  });
  if (missing.length) {
    const batch = lookupInboxes(nostr, missing);
    for (const pubkey of missing) {
      const lookup = batch.then(results => results.get(pubkey)!);
      cache.set(pubkey, { at: now, lookup });
      // Don't keep failures: the next attempt should look again
      void lookup.then(result => { if (result.status === 'failed' && cache!.get(pubkey)?.lookup === lookup) cache!.delete(pubkey); });
    }
  }
  return new Map(await Promise.all(pubkeys.map(async (pubkey): Promise<[string, InboxLookup]> => [pubkey, await cache!.get(pubkey)!.lookup])));
}

/** Looks up NIP-17 inbox relays (kind 10050), telling "none advertised" apart from "lookup failed". */
export async function lookupInboxes(nostr: DeliveryRelays, pubkeys: string[], signal?: AbortSignal): Promise<Map<string, InboxLookup>> {
  try {
    // The pool applies its own timeout and rejects only if no relay answered.
    const lists = await nostr.query([{ kinds: [10050], authors: pubkeys, limit: pubkeys.length }], { signal });
    const inboxes = inboxRelaysFrom(lists);
    return new Map(pubkeys.map((pubkey): [string, InboxLookup] => {
      const relays = inboxes.get(pubkey) ?? [];
      return [pubkey, relays.length ? { status: 'found', relays } : { status: 'none' }];
    }));
  } catch (error) {
    signal?.throwIfAborted();
    const failure: InboxLookup = { status: 'failed', error: describeError(error) };
    return new Map(pubkeys.map(pubkey => [pubkey, failure]));
  }
}

/** Encrypts and signs a message: NIP-17 gift wraps with a NIP-44 signer, otherwise NIP-04. */
export async function prepareDirectMessage(signer: NostrSigner, sender: string, recipient: string, text: string): Promise<PreparedMessage> {
  if (supportsNip17(signer)) {
    const { rumor, recipientWrap, senderWrap } = await wrapDirectMessage(signer, sender, recipient, text);
    return { protocol: 'nip17', sender, recipient, rumor, recipientWrap, senderWrap };
  }
  if (!signer.nip04) throw new Error('Your signer does not support encrypted messages.');
  const content = await signer.nip04.encrypt(recipient, text);
  // Same convention as useNostrPublish: on https, name the client
  const client = typeof location !== 'undefined' && location.protocol === 'https:' ? [['client', location.hostname]] : [];
  const event = await signer.signEvent({ kind: 4, content, tags: [['p', recipient], ...client], created_at: Math.floor(Date.now() / 1000) });
  return { protocol: 'nip04', sender, recipient, text, event };
}

export function newDelivery(prepared: PreparedMessage): MessageDelivery {
  return { prepared, recipient: { status: 'pending' }, senderCopy: prepared.protocol === 'nip17' ? { status: 'pending' } : null };
}

/**
 * Attempts the parts of a delivery that haven't succeeded yet, re-sending the same signed
 * events. A part that was delivered is never sent again. The sender's copy is only stored
 * once the recipient has the message, so history never shows a message they didn't get.
 */
export async function deliverMissing(nostr: DeliveryRelays, delivery: MessageDelivery): Promise<MessageDelivery> {
  const { prepared } = delivery;

  if (prepared.protocol === 'nip04') {
    if (delivery.recipient.status === 'delivered') return delivery;
    try {
      await nostr.event(prepared.event, { signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS) });
      return { ...delivery, recipient: { status: 'delivered', via: 'app-relays' } };
    } catch (error) {
      return { ...delivery, recipient: { status: 'failed', error: describeError(error) } };
    }
  }

  const send = async (wrap: NostrEvent, inbox: InboxLookup): Promise<PartOutcome> => {
    if (inbox.status === 'failed') {
      return { status: 'failed', error: `couldn't look up their inbox relays (${inbox.error}), so nothing was sent` };
    }
    try {
      await nostr.event(wrap, {
        signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
        ...(inbox.status === 'found' ? { relays: inbox.relays } : {}),
      });
      return { status: 'delivered', via: inbox.status === 'found' ? 'inbox' : 'app-relays' };
    } catch (error) {
      return { status: 'failed', error: describeError(error) };
    }
  };

  // Look up everyone this attempt may deliver to in one request (reusing recent lookups)
  const needRecipient = delivery.recipient.status !== 'delivered';
  const needCopy = !!delivery.senderCopy && delivery.senderCopy.status !== 'delivered';
  const inboxes = await lookupInboxesCached(nostr, [
    ...(needRecipient ? [prepared.recipient] : []),
    ...(needCopy ? [prepared.sender] : []),
  ]);

  let next = delivery;
  if (needRecipient) {
    next = { ...next, recipient: await send(prepared.recipientWrap, inboxes.get(prepared.recipient)!) };
    if (next.recipient.status !== 'delivered') return next;
  }
  if (needCopy) {
    next = { ...next, senderCopy: await send(prepared.senderWrap, inboxes.get(prepared.sender)!) };
  }
  return next;
}

/** Per-invitee outcome of a batch of invitations. */
export function summarizeDeliveries(deliveries: MessageDelivery[]) {
  return {
    total: deliveries.length,
    delivered: deliveries.filter(d => d.recipient.status === 'delivered'),
    undelivered: deliveries.filter(d => d.recipient.status !== 'delivered'),
    copiesMissing: deliveries.filter(d => d.recipient.status === 'delivered' && d.senderCopy !== null && d.senderCopy.status !== 'delivered'),
  };
}

/** What happened to a message sent this session, with the matching recovery action. */
export function deliveryStatusText(delivery: MessageDelivery): { text: string; action?: string } {
  const { recipient, senderCopy } = delivery;
  if (recipient.status === 'pending') return { text: 'Sending…' };
  if (recipient.status === 'failed') return { text: `Not delivered: ${recipient.error}.`, action: 'Retry' };
  if (senderCopy?.status === 'failed') {
    return {
      text: `Delivered, but your own copy wasn't saved (${senderCopy.error}), so it won't appear on your other devices.`,
      action: 'Save my copy',
    };
  }
  if (senderCopy?.status === 'pending') return { text: 'Delivered. Saving your copy…' };
  return { text: 'Delivered' };
}
