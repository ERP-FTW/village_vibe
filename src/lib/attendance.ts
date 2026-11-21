import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Event check-ins (kind 2073) are self-reported. The host's code is generated in their
 * browser and nobody checks it, so any 13-digit number produces a check-in that looks the
 * same. A check-in is a public statement by the attendee, not proof of attendance, and it
 * earns nothing automatically. The `nonce` and `verified_at` tags (legacy names) carry no
 * proof either; readers never treat them as verification.
 */
export const CHECK_IN_TRUST_NOTE =
  'Check-ins are self-reported. Village Vibe doesn’t check the code, so a check-in doesn’t prove someone attended and doesn’t earn a badge.';

const EVENT_KINDS = ['36959', '31923'];

/** A readable check-in for a 36959 or 31923 event (older records with any tag set still load). */
export function isCheckIn(event: NostrEvent): boolean {
  if (event.kind !== 2073) return false;
  const coordinate = event.tags.find(([name]) => name === 'a')?.[1];
  return !!coordinate && EVENT_KINDS.includes(coordinate.split(':')[0]);
}

/** The only trust level a check-in has, whatever tags it carries. */
export function checkInTrust(_event: NostrEvent): 'self-reported' {
  return 'self-reported';
}

/** When the attendee published the check-in (their own clock; `verified_at` is not used). */
export function checkInTime(event: NostrEvent): number {
  return event.created_at;
}

/** Tags for a new self-reported check-in. `nonce`/`verified_at` keep older clients reading it. */
export function checkInTags(input: {
  event: NostrEvent;
  coordinate: string;
  code: string;
  location?: string;
  now?: number;
}): string[][] {
  const title = input.event.tags.find(([name]) => name === 'title')?.[1] || 'event';
  const tags: string[][] = [
    ['a', input.coordinate],
    ['e', input.event.id],
    ['p', input.event.pubkey],
    // Legacy tags: the code the attendee entered and when. Neither is verified.
    ['nonce', input.code],
    ['verified_at', String(input.now ?? Math.floor(Date.now() / 1000))],
    ['alt', `Self-reported check-in for ${title}`],
  ];
  if (input.location) tags.push(['location', input.location]);
  return tags;
}
