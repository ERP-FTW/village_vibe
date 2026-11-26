// @vitest-environment node
// Signing needs Node's Uint8Array (jsdom's fails @noble/hashes' type check).
import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { NSecSigner, type NostrEvent, type NostrSigner } from '@nostrify/nostrify';
import { deliverMissing, lookupInboxesCached, newDelivery, prepareDirectMessage, type DeliveryRelays } from '@/lib/dmDelivery';
import { invitationsComplete, retryInvitations, sendInvitations } from '@/lib/invitations';

const senderKey = generateSecretKey();
const sender = getPublicKey(senderKey);
const signer = new NSecSigner(senderKey);
const person = () => getPublicKey(generateSecretKey());

const INBOX = 'wss://inbox.example';
const SENDER_INBOX = 'wss://sender-inbox.example';

interface FakeOptions {
  inboxes?: Record<string, string[]>;
  /** Make the kind 10050 lookup fail, e.g. with a timeout. */
  lookupFails?: () => boolean;
  /** Reject a publish (event, target relays). */
  rejects?: (event: NostrEvent, relays?: string[]) => boolean;
}

/** In-memory relays: records every accepted publish and each lookup. */
function fakeRelays(options: FakeOptions = {}) {
  const published: { event: NostrEvent; relays?: string[] }[] = [];
  let lookups = 0;
  const relays: DeliveryRelays = {
    async query(filters) {
      lookups++;
      if (options.lookupFails?.()) throw new DOMException('Relay query timed out', 'TimeoutError');
      const authors = filters[0].authors ?? [];
      return authors.filter(author => options.inboxes?.[author]).map(author => ({
        id: author, pubkey: author, kind: 10050, created_at: 1, content: '', sig: '',
        tags: options.inboxes![author].map(url => ['relay', url]),
      }));
    },
    async event(event, opts) {
      if (options.rejects?.(event, opts?.relays)) throw new Error('blocked: rate limited');
      published.push({ event, relays: opts?.relays });
    },
  };
  return { relays, published, lookups: () => lookups };
}

describe('direct message delivery', () => {
  it('reports a delivered message whose sender copy failed, and retries only the copy', async () => {
    const recipient = person();
    let senderInboxDown = true;
    const fake = fakeRelays({
      inboxes: { [recipient]: [INBOX], [sender]: [SENDER_INBOX] },
      rejects: (_event, relays) => senderInboxDown && relays?.includes(SENDER_INBOX) === true,
    });
    const prepared = await prepareDirectMessage(signer, sender, recipient, 'hello');
    if (prepared.protocol !== 'nip17') throw new Error('expected NIP-17');

    const first = await deliverMissing(fake.relays, newDelivery(prepared));
    expect(first.recipient).toEqual({ status: 'delivered', via: 'inbox' });
    expect(first.senderCopy).toMatchObject({ status: 'failed', error: 'blocked: rate limited' });
    expect(fake.published.map(p => p.event.id)).toEqual([prepared.recipientWrap.id]);
    expect(fake.published[0].relays).toEqual([INBOX]);

    senderInboxDown = false;
    const retried = await deliverMissing(fake.relays, first);
    expect(retried.senderCopy).toEqual({ status: 'delivered', via: 'inbox' });
    // The recipient was not sent the message again; the same signed copy was stored
    expect(fake.published.map(p => p.event.id)).toEqual([prepared.recipientWrap.id, prepared.senderWrap.id]);
  });

  it('sends nothing when the inbox lookup fails, unlike when no inbox is advertised', async () => {
    const recipient = person();
    let lookupDown = true;
    const fake = fakeRelays({ inboxes: { [recipient]: [INBOX] }, lookupFails: () => lookupDown });
    const prepared = await prepareDirectMessage(signer, sender, recipient, 'hello');
    if (prepared.protocol !== 'nip17') throw new Error('expected NIP-17');

    const failed = await deliverMissing(fake.relays, newDelivery(prepared));
    expect(failed.recipient.status).toBe('failed');
    expect(failed.recipient.status === 'failed' && failed.recipient.error).toMatch(/couldn't look up their inbox relays \(timed out\)/);
    expect(failed.senderCopy).toEqual({ status: 'pending' }); // never stored before the recipient has it
    expect(fake.published).toEqual([]);

    lookupDown = false;
    const retried = await deliverMissing(fake.relays, failed);
    expect(retried.recipient).toEqual({ status: 'delivered', via: 'inbox' });
    expect(fake.published[0]).toEqual({ event: prepared.recipientWrap, relays: [INBOX] });

    // A successful lookup with no advertised inbox falls back to the app's relays
    const noInbox = fakeRelays();
    const fallback = await deliverMissing(noInbox.relays, newDelivery(await prepareDirectMessage(signer, sender, person(), 'hi')));
    expect(fallback.recipient).toEqual({ status: 'delivered', via: 'app-relays' });
    expect(noInbox.published[0].relays).toBeUndefined();
  });

  it('says "timed out" when a relay does not answer the publish in time', async () => {
    // What a relay connection throws when the publish timeout fires
    const silent: DeliveryRelays = {
      query: async () => [],
      event: async () => { throw new DOMException('The signal has been aborted', 'AbortError'); },
    };
    const failed = await deliverMissing(silent, newDelivery(await prepareDirectMessage(signer, sender, person(), 'hi')));
    expect(failed.recipient).toEqual({ status: 'failed', error: 'timed out' });
  });

  it('looks up the recipient and sender inboxes together, once', async () => {
    const recipient = person();
    const fake = fakeRelays({ inboxes: { [recipient]: [INBOX], [sender]: [SENDER_INBOX] } });
    const delivered = await deliverMissing(fake.relays, newDelivery(await prepareDirectMessage(signer, sender, recipient, 'hi')));
    expect(delivered.recipient.status).toBe('delivered');
    expect(delivered.senderCopy?.status).toBe('delivered');
    expect(fake.lookups()).toBe(1);
  });

  it('keeps the client tag on NIP-04 messages sent from an https page', async () => {
    const original = (globalThis as { location?: unknown }).location;
    (globalThis as { location?: unknown }).location = { protocol: 'https:', hostname: 'village.example' };
    try {
      const nip04Only: NostrSigner = {
        getPublicKey: () => signer.getPublicKey(), signEvent: (event) => signer.signEvent(event), nip04: signer.nip04,
      };
      const prepared = await prepareDirectMessage(nip04Only, sender, person(), 'hello');
      expect(prepared.protocol === 'nip04' && prepared.event.tags).toContainEqual(['client', 'village.example']);
    } finally {
      (globalThis as { location?: unknown }).location = original;
    }
  });

  it('retries a NIP-04 message with the same signed event', async () => {
    const nip04Only: NostrSigner = {
      getPublicKey: () => signer.getPublicKey(),
      signEvent: (event) => signer.signEvent(event),
      nip04: signer.nip04,
    };
    let down = true;
    const fake = fakeRelays({ rejects: () => down });
    const prepared = await prepareDirectMessage(nip04Only, sender, person(), 'hello');
    expect(prepared.protocol).toBe('nip04');

    const failed = await deliverMissing(fake.relays, newDelivery(prepared));
    expect(failed.recipient.status).toBe('failed');
    expect(failed.senderCopy).toBeNull();

    down = false;
    const retried = await deliverMissing(fake.relays, failed);
    expect(retried.recipient.status).toBe('delivered');
    expect(prepared.protocol === 'nip04' && fake.published.map(p => p.event.id)).toEqual([prepared.protocol === 'nip04' && prepared.event.id]);
  });
});

describe('event invitations', () => {
  it('retries only the invitation that failed, without publishing the event again', async () => {
    const [alice, bob, carol] = [person(), person(), person()];
    let carolDown = true;
    const fake = fakeRelays({
      inboxes: { [carol]: ['wss://carol.example'] },
      rejects: (_event, relays) => carolDown && relays?.includes('wss://carol.example') === true,
    });
    const send = async ({ recipient, message }: { recipient: string; message: string }) =>
      deliverMissing(fake.relays, newDelivery(await prepareDirectMessage(signer, sender, recipient, message)));
    const retry = (delivery: Parameters<typeof deliverMissing>[1]) => deliverMissing(fake.relays, delivery);

    // The hook primes one lookup for the whole batch
    await lookupInboxesCached(fake.relays, [alice, bob, carol, sender]);
    const outcome = await sendInvitations(send, `${sender}:seed-swap`, [alice, bob, carol, bob], 'details');
    expect(fake.lookups()).toBe(1);
    expect(outcome.deliveries).toHaveLength(3); // duplicates collapse
    expect(invitationsComplete(outcome)).toBe(false);
    const undelivered = outcome.deliveries.filter(d => d.recipient.status !== 'delivered').map(d => d.prepared.recipient);
    expect(undelivered).toEqual([carol]);
    const publishedBefore = fake.published.length;

    carolDown = false;
    const retried = await retryInvitations(outcome, send, retry);
    expect(invitationsComplete(retried)).toBe(true);

    const newlyPublished = fake.published.slice(publishedBefore).map(p => p.event);
    // Only gift wraps were published (no event), and none went to Alice or Bob again
    expect(newlyPublished.every(event => event.kind === 1059)).toBe(true);
    const wrapRecipients = newlyPublished.map(event => event.tags.find(([name]) => name === 'p')?.[1]);
    expect(wrapRecipients).toEqual([carol, sender]); // Carol's invitation, then the organizer's copy
  });

  it('keeps invitees whose message could not be prepared, and prepares them on retry', async () => {
    const dana = person();
    let signerDeclines = true;
    const fake = fakeRelays();
    const send = async ({ recipient, message }: { recipient: string; message: string }) => {
      if (signerDeclines) throw new Error('Signer declined');
      return deliverMissing(fake.relays, newDelivery(await prepareDirectMessage(signer, sender, recipient, message)));
    };
    const retry = (delivery: Parameters<typeof deliverMissing>[1]) => deliverMissing(fake.relays, delivery);

    const outcome = await sendInvitations(send, 'event', [dana], 'details');
    expect(outcome.unprepared).toEqual([{ recipient: dana, error: 'Signer declined' }]);
    expect(fake.published).toEqual([]);

    signerDeclines = false;
    const retried = await retryInvitations(outcome, send, retry);
    expect(invitationsComplete(retried)).toBe(true);
    expect(retried.deliveries.map(d => d.prepared.recipient)).toEqual([dana]);
  });
});
