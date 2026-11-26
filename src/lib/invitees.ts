import { nip19 } from 'nostr-tools';

/** One entry that could not be used as an invitee, and why (worded for the person typing). */
export interface RejectedInvitee {
  /** The entry, shortened for display. A secret key is never repeated. */
  value: string;
  reason: string;
  /** The entry as typed, to leave in the field for correction. Empty for a secret key. */
  entry: string;
}

export interface ParsedInvitees {
  /** Hex pubkeys in the order given, each once. */
  pubkeys: string[];
  rejected: RejectedInvitee[];
}

const HEX_KEY = /^[0-9a-f]{64}$/;

/** A person's hex pubkey from a hex key, npub or nprofile (a `nostr:` prefix is allowed). */
function toPubkey(entry: string): string | { reason: string } {
  const value = entry.replace(/^nostr:/i, '');
  if (HEX_KEY.test(value.toLowerCase())) return value.toLowerCase();
  // A secret key must never be echoed, stored or sent anywhere: say so and stop.
  if (/^nsec1/i.test(value)) return { reason: 'is a secret key. Never share one; use the npub instead' };
  try {
    const decoded = nip19.decode(value.toLowerCase());
    if (decoded.type === 'npub') return decoded.data;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
    return { reason: `is ${decoded.type === 'note' || decoded.type === 'nevent' || decoded.type === 'naddr' ? 'a post' : 'not a person'}, not someone to invite` };
  } catch {
    return { reason: 'is not a valid npub, nprofile or 64-character hex key' };
  }
}

/**
 * Read the people typed or pasted into the invite field: npub, nprofile or hex pubkeys,
 * separated by spaces, commas, semicolons or new lines. Each person is returned once,
 * whichever form (or how often) they were given in. Anything else is reported, never
 * guessed at: an invitee list is published, so a wrong key would invite a stranger.
 */
export function parseInvitees(input: string): ParsedInvitees {
  const pubkeys: string[] = [];
  const rejected: RejectedInvitee[] = [];
  for (const entry of input.split(/[\s,;]+/).filter(Boolean)) {
    const result = toPubkey(entry);
    if (typeof result !== 'string') {
      // Show enough to find the entry again, and nothing of a secret key.
      const secret = /^(nostr:)?nsec1/i.test(entry);
      const value = secret ? 'nsec1…' : entry.length > 24 ? `${entry.slice(0, 12)}…${entry.slice(-6)}` : entry;
      rejected.push({ value, reason: result.reason, entry: secret ? '' : entry });
    } else if (!pubkeys.includes(result)) {
      pubkeys.push(result);
    }
  }
  return { pubkeys, rejected };
}

/** `existing` followed by the pubkeys of `added` that are not in it yet. */
export function mergeInvitees(existing: string[], added: string[]): string[] {
  return [...existing, ...added.filter(pubkey => !existing.includes(pubkey))];
}
