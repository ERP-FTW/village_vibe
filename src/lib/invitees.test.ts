// @vitest-environment node
// NIP-19 encoding needs Node's Uint8Array (see dmDelivery.test.ts).
import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import { mergeInvitees, parseInvitees } from './invitees';

const ANA = 'a1'.repeat(32);
const BEN = 'b2'.repeat(32);
const CAM = 'c3'.repeat(32);

describe('parseInvitees', () => {
  it('reads hex keys, npubs and nprofiles', () => {
    const input = [ANA, nip19.npubEncode(BEN), nip19.nprofileEncode({ pubkey: CAM, relays: ['wss://relay.example'] })].join(' ');
    expect(parseInvitees(input)).toEqual({ pubkeys: [ANA, BEN, CAM], rejected: [] });
  });

  it('returns each person once, whichever forms they were given in', () => {
    const input = [
      nip19.npubEncode(ANA), ANA, ANA.toUpperCase(), `nostr:${nip19.npubEncode(ANA)}`,
      nip19.nprofileEncode({ pubkey: ANA }), nip19.npubEncode(BEN).toUpperCase(), BEN,
    ].join('\n');
    expect(parseInvitees(input).pubkeys).toEqual([ANA, BEN]);
  });

  it('accepts spaces, commas, semicolons and new lines between entries', () => {
    expect(parseInvitees(`${ANA}, ${BEN};${CAM}\n\n  ${ANA}\t`).pubkeys).toEqual([ANA, BEN, CAM]);
    expect(parseInvitees('  \n ')).toEqual({ pubkeys: [], rejected: [] });
  });

  it('rejects anything that is not a person\'s key, and says why', () => {
    const note = nip19.noteEncode('d4'.repeat(32));
    const address = nip19.naddrEncode({ kind: 36959, pubkey: ANA, identifier: 'dinner' });
    const broken = nip19.npubEncode(BEN).slice(0, -1) + (nip19.npubEncode(BEN).endsWith('q') ? 'p' : 'q');
    const { pubkeys, rejected } = parseInvitees([ANA, 'ben', ANA.slice(1), `${ANA}0`, broken, note, address, 'npub1'].join(' '));
    expect(pubkeys).toEqual([ANA]);
    expect(rejected.map(({ reason }) => reason)).toEqual([
      'is not a valid npub, nprofile or 64-character hex key',
      'is not a valid npub, nprofile or 64-character hex key',
      'is not a valid npub, nprofile or 64-character hex key',
      'is not a valid npub, nprofile or 64-character hex key',
      'is a post, not someone to invite',
      'is a post, not someone to invite',
      'is not a valid npub, nprofile or 64-character hex key',
    ]);
    // Rejected entries are kept as typed so they can be corrected, and shortened for display
    expect(rejected[0]).toMatchObject({ value: 'ben', entry: 'ben' });
    expect(rejected[3].entry).toBe(broken);
    expect(rejected[3].value.length).toBeLessThan(broken.length);
  });

  it('never repeats a secret key', () => {
    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(7));
    for (const entry of [nsec, `nostr:${nsec}`, nsec.toUpperCase()]) {
      const { pubkeys, rejected } = parseInvitees(`${ANA} ${entry}`);
      expect(pubkeys).toEqual([ANA]);
      expect(rejected).toEqual([{ value: 'nsec1…', reason: 'is a secret key. Never share one; use the npub instead', entry: '' }]);
      expect(JSON.stringify(rejected).toLowerCase()).not.toContain(nsec.slice(5));
    }
  });
});

describe('mergeInvitees', () => {
  it('adds only people who are not invited yet, keeping the order', () => {
    expect(mergeInvitees([ANA, BEN], [BEN, CAM, ANA])).toEqual([ANA, BEN, CAM]);
    expect(mergeInvitees([], [])).toEqual([]);
  });
});
