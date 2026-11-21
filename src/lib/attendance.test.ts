import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { checkInTags, checkInTime, checkInTrust, isCheckIn } from './attendance';

const host = 'h'.repeat(64);
const event: NostrEvent = {
  id: 'e'.repeat(64), pubkey: host, kind: 36959, created_at: 1_800_000_000, content: '', sig: '',
  tags: [['d', 'seed-swap'], ['title', 'Seed swap']],
};

function checkIn(tags: string[][], createdAt = 1_800_000_100): NostrEvent {
  return { id: 'c'.repeat(64), pubkey: 'a'.repeat(64), kind: 2073, created_at: createdAt, content: '', sig: '', tags };
}

describe('self-reported check-ins', () => {
  it('treats a check-in with any 13-digit code as self-reported, never verified', () => {
    const arbitrary = checkIn(checkInTags({ event, coordinate: `36959:${host}:seed-swap`, code: '0000000000000' }));

    expect(isCheckIn(arbitrary)).toBe(true);
    expect(checkInTrust(arbitrary)).toBe('self-reported');
    expect(arbitrary.tags).toContainEqual(['alt', 'Self-reported check-in for Seed swap']);
  });

  it('ignores verified_at: the check-in time is when it was published', () => {
    const backdated = checkIn([['a', `36959:${host}:seed-swap`], ['nonce', '1234567890123'], ['verified_at', '1000']]);

    expect(checkInTime(backdated)).toBe(1_800_000_100);
    expect(checkInTrust(backdated)).toBe('self-reported');
  });

  it('still reads older check-ins, including ones without the legacy tags', () => {
    expect(isCheckIn(checkIn([['a', `31923:${host}:old-event`], ['nonce', '1'], ['verified_at', '1']]))).toBe(true);
    expect(isCheckIn(checkIn([['a', `36959:${host}:seed-swap`]]))).toBe(true);
  });

  it('rejects records that are not check-ins for an event', () => {
    expect(isCheckIn(checkIn([]))).toBe(false);
    expect(isCheckIn(checkIn([['a', `30023:${host}:story`]]))).toBe(false);
    expect(isCheckIn({ ...checkIn([['a', `36959:${host}:x`]]), kind: 1 })).toBe(false);
  });
});
