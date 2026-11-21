import type { NostrEvent } from '@nostrify/nostrify';

export type RSVPStatus = 'accepted' | 'tentative' | 'declined';

/**
 * Informal RSVP intent from a discussion reply.
 *
 * Negative and tentative phrases are checked before positive ones, so "not going" or
 * "not sure I'm coming" are not read as "going". Positive idioms that contain negative
 * words ("can't wait", "wouldn't miss it") are recognised first.
 */
export function detectRSVPStatus(content: string): RSVPStatus | null {
  const text = ` ${content.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim()} `;
  const has = (pattern: RegExp) => pattern.test(text);

  if (has(/\b(can'?t wait|cannot wait|wouldn'?t miss|won'?t miss|not missing)\b/)) return 'accepted';
  if (has(/\b(not going|not coming|not attending|can'?t (make|come|go|attend|join)|cannot (make|come|attend)|won'?t (make|be|come|attend)|unable to|decline|have to miss|gonna miss|will miss|count me out|no can do)\b/)
    || /❌|👎/.test(text)
    || has(/^ no\b(?! (problem|worries|doubt))/)) return 'declined';
  if (has(/\b(maybe|might|tentative|possibly|not sure|unsure|will try|hope to|probably)\b/) || /🤔/.test(text)) return 'tentative';
  if (has(/\b(yes|yep|yeah|going|i'?m in|count me in|attending|i'?ll be there|will attend|coming|see you there|accept)\b/)
    || /👍|✅|🙋/.test(text)) return 'accepted';
  return null;
}

/**
 * The latest RSVP per person. NIP-52 RSVPs are addressable per author and d tag, so one
 * person can have several (different clients pick different d tags). RSVPs published by
 * a host on someone else's behalf are ignored: an RSVP only speaks for its signer.
 */
export function latestRSVPs(rsvps: NostrEvent[]): NostrEvent[] {
  const latest = new Map<string, NostrEvent>();
  for (const rsvp of rsvps) {
    if (rsvp.tags.some(([name]) => name === 'created_by_host')) continue;
    const current = latest.get(rsvp.pubkey);
    if (!current || rsvp.created_at > current.created_at) latest.set(rsvp.pubkey, rsvp);
  }
  return [...latest.values()];
}
