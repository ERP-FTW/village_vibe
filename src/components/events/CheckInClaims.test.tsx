import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { TestApp } from '@/test/TestApp';
import { CHECK_IN_TRUST_NOTE, checkInTags } from '@/lib/attendance';

const host = 'h'.repeat(64);
const attendee = 'a'.repeat(64);
const event: NostrEvent = {
  id: 'e'.repeat(64), pubkey: host, kind: 36959, created_at: 1_800_000_000, content: '', sig: '',
  tags: [['d', 'seed-swap'], ['title', 'Seed swap']],
};
// A check-in made with a made-up code and a misleading verified_at
const checkIn: NostrEvent = {
  id: 'c'.repeat(64), pubkey: attendee, kind: 2073, created_at: 1_800_003_600, content: '', sig: '',
  tags: [...checkInTags({ event, coordinate: `36959:${host}:seed-swap`, code: '9999999999999', now: 1 })],
};

vi.mock('@/hooks/useEvents', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/hooks/useEvents')>(),
  useEventAttendance: () => ({ data: [checkIn] }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: attendee, signer: {} } }),
}));
vi.mock('@/hooks/useAuthor', () => ({ useAuthor: () => ({ data: undefined }) }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,' } }));

const { EventCheckIn } = await import('./EventCheckIn');
const { AttendeeCheckIn } = await import('./AttendeeCheckIn');
const { EventAttendeeList } = await import('./EventAttendeeList');

describe('check-in claims', () => {
  it('host and attendee screens describe the same self-reported trust level', () => {
    render(<TestApp><EventCheckIn eventId={`${host}:seed-swap`} event={event} /></TestApp>);
    render(<TestApp><AttendeeCheckIn eventId={`${host}:seed-swap`} event={event} /></TestApp>);

    expect(screen.getAllByText(CHECK_IN_TRUST_NOTE)).toHaveLength(2);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/automatically awarded/i);
    expect(text).not.toMatch(/for security/i);
    expect(text).not.toMatch(/verif/i);
  });

  it('shows the published time, not the claimed verified_at time', () => {
    render(<TestApp><EventCheckIn eventId={`${host}:seed-swap`} event={event} /></TestApp>);
    expect(screen.getByText(new Date(checkIn.created_at * 1000).toLocaleTimeString())).toBeInTheDocument();
    expect(screen.getByText('People checked in (self-reported)')).toBeInTheDocument();
  });

  it('lists a made-up-code check-in as self-reported, with no verified status', () => {
    const rsvp: NostrEvent = {
      id: 'r'.repeat(64), pubkey: attendee, kind: 31925, created_at: 1_799_000_000, content: '', sig: '',
      tags: [['a', `36959:${host}:seed-swap`], ['status', 'accepted']],
    };
    render(<TestApp><EventAttendeeList rsvps={[rsvp]} isLoading={false} attendanceRecords={[checkIn]} /></TestApp>);

    expect(screen.getByText('Checked in, self-reported (1)')).toBeInTheDocument();
    expect(screen.getByText(CHECK_IN_TRUST_NOTE)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/verified/i);
  });
});
