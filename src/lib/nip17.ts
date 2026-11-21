import type { NostrEvent, NostrSigner } from '@nostrify/nostrify';
import { finalizeEvent, generateSecretKey, getEventHash, nip44, verifyEvent } from 'nostr-tools';

/**
 * NIP-17 private direct messages (NIP-59 gift wraps), using only the signer interface:
 *
 *   rumor (kind 14, unsigned) -> seal (kind 13, signed by the sender, NIP-44 to recipient)
 *   -> gift wrap (kind 1059, signed by a one-time key, NIP-44 to recipient)
 *
 * Unlike NIP-04 (kind 4), relays only see the gift wrap: neither the sender nor the
 * timing of the real message is public.
 */

export interface Rumor {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

type Nip44Signer = NostrSigner & { nip44: NonNullable<NostrSigner['nip44']> };

export function supportsNip17(signer: NostrSigner | undefined): signer is Nip44Signer {
  return !!signer?.nip44;
}

/** Random timestamp up to two days in the past (NIP-59 recommends hiding real timing). */
function randomPast(): number {
  return Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 2 * 24 * 60 * 60);
}

/** Gift-wrap a seal for one recipient with a one-time key. */
function giftWrap(seal: NostrEvent, recipient: string): NostrEvent {
  const oneTimeKey = generateSecretKey();
  const content = nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(oneTimeKey, recipient));
  return finalizeEvent({ kind: 1059, created_at: randomPast(), tags: [['p', recipient]], content }, oneTimeKey);
}

/**
 * Build the gift wraps for a kind 14 message: one for the recipient and one for the
 * sender (so the sender's other devices and this client can show sent messages).
 */
export async function wrapDirectMessage(
  signer: Nip44Signer, senderPubkey: string, recipient: string, message: string,
): Promise<{ recipientWrap: NostrEvent; senderWrap: NostrEvent; rumor: Rumor }> {
  const unsigned = {
    pubkey: senderPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 14,
    tags: [['p', recipient]],
    content: message,
  };
  const rumor: Rumor = { ...unsigned, id: getEventHash(unsigned) };

  const sealFor = async (target: string) => signer.signEvent({
    kind: 13,
    created_at: randomPast(),
    tags: [],
    content: await signer.nip44.encrypt(target, JSON.stringify(rumor)),
  });

  const [recipientSeal, senderSeal] = await Promise.all([sealFor(recipient), sealFor(senderPubkey)]);
  return { recipientWrap: giftWrap(recipientSeal, recipient), senderWrap: giftWrap(senderSeal, senderPubkey), rumor };
}

/** Structural check: a decrypted payload is only trusted once it has a rumor's shape. */
function isRumor(value: unknown): value is Rumor {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return typeof r.id === 'string'
    && typeof r.pubkey === 'string' && /^[0-9a-f]{64}$/.test(r.pubkey)
    && typeof r.created_at === 'number' && Number.isFinite(r.created_at)
    && typeof r.kind === 'number'
    && typeof r.content === 'string'
    && Array.isArray(r.tags)
    && r.tags.every(tag => Array.isArray(tag) && tag.every(part => typeof part === 'string'));
}

/** Thrown when the signer could not decrypt (declined, disconnected): worth retrying later. */
export class SignerUnavailableError extends Error {}

class InvalidPayloadError extends Error {}

/**
 * Open a gift wrap addressed to the signer. Returns null for anything that is not a valid
 * kind 14 message: bad signatures, a rumor whose author differs from the seal's signer
 * (impersonation), or malformed content. Throws SignerUnavailableError when the signer
 * itself failed, so callers can retry instead of treating the message as invalid.
 */
export async function unwrapDirectMessage(signer: Nip44Signer, wrap: NostrEvent): Promise<Rumor | null> {
  const decrypt = async (pubkey: string, payload: string) => {
    try {
      return await signer.nip44.decrypt(pubkey, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A malformed payload will never decrypt: treat it as invalid, not as a signer outage
      if (/invalid|mac|padding|version|length|base64|decode/i.test(message)) throw new InvalidPayloadError(message);
      throw new SignerUnavailableError(message || 'Signer could not decrypt');
    }
  };
  let seal: NostrEvent;
  try {
    seal = JSON.parse(await decrypt(wrap.pubkey, wrap.content)) as NostrEvent;
  } catch (error) {
    if (error instanceof SignerUnavailableError) throw error;
    return null;
  }
  if (!seal || seal.kind !== 13 || !verifyEvent(seal)) return null;
  let rumor: unknown;
  try {
    rumor = JSON.parse(await decrypt(seal.pubkey, seal.content));
  } catch (error) {
    if (error instanceof SignerUnavailableError) throw error;
    return null;
  }
  if (!isRumor(rumor) || rumor.kind !== 14 || rumor.pubkey !== seal.pubkey) return null;
  return rumor;
}

/** NIP-17 inbox relays (kind 10050 `relay` tags) per pubkey. */
export function inboxRelaysFrom(lists: NostrEvent[]): Map<string, string[]> {
  const newest = new Map<string, NostrEvent>();
  for (const list of lists) {
    if (list.kind !== 10050) continue;
    const current = newest.get(list.pubkey);
    if (!current || list.created_at > current.created_at) newest.set(list.pubkey, list);
  }
  return new Map([...newest].map(([pubkey, list]) => [
    pubkey,
    [...new Set(list.tags.filter(([name, url]) => name === 'relay' && url?.startsWith('wss://')).map(([, url]) => url))].slice(0, 5),
  ]));
}
