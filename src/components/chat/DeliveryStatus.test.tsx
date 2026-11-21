import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { TestApp } from '@/test/TestApp';
import type { MessageDelivery, PartOutcome } from '@/lib/dmDelivery';
import type { InvitationOutcome } from '@/lib/invitations';
import { DeliveryStatus } from './DeliveryStatus';

vi.mock('@/hooks/useAuthor', () => ({
  useAuthor: (pubkey: string) => ({ data: { metadata: { name: `name-${pubkey}` } } }),
}));
const { InvitationRecovery } = await import('@/components/events/InvitationRecovery');

const wrap = { id: 'w', pubkey: 'p', kind: 1059, created_at: 1, tags: [], content: '', sig: '' } as NostrEvent;
function delivery(recipientName: string, recipient: PartOutcome, senderCopy: PartOutcome | null = { status: 'delivered', via: 'inbox' }): MessageDelivery {
  return {
    prepared: {
      protocol: 'nip17', sender: 'me', recipient: recipientName,
      rumor: { id: `r-${recipientName}`, pubkey: 'me', created_at: 1, kind: 14, tags: [], content: 'hi' },
      recipientWrap: wrap, senderWrap: wrap,
    },
    recipient,
    senderCopy,
  };
}

describe('DeliveryStatus', () => {
  it('offers Retry when the recipient did not get the message', () => {
    const onRetry = vi.fn();
    render(<TestApp><DeliveryStatus delivery={delivery('bob', { status: 'failed', error: 'timed out' }, { status: 'pending' })} onRetry={onRetry} /></TestApp>);
    expect(screen.getByText('Not delivered: timed out.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('says the message was delivered when only the sender copy failed', () => {
    render(<TestApp><DeliveryStatus delivery={delivery('bob', { status: 'delivered', via: 'inbox' }, { status: 'failed', error: 'blocked' })} onRetry={() => {}} /></TestApp>);
    expect(screen.getByText(/^Delivered, but your own copy wasn't saved \(blocked\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save my copy/ })).toBeInTheDocument();
  });

  it('shows no action once everything was delivered', () => {
    render(<TestApp><DeliveryStatus delivery={delivery('bob', { status: 'delivered', via: 'app-relays' })} onRetry={() => {}} /></TestApp>);
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('InvitationRecovery', () => {
  const outcome: InvitationOutcome = {
    eventId: 'organizer:seed-swap',
    message: 'details',
    deliveries: [
      delivery('alice', { status: 'delivered', via: 'inbox' }),
      delivery('bob', { status: 'delivered', via: 'inbox' }, { status: 'failed', error: 'blocked' }),
      delivery('carol', { status: 'failed', error: 'timed out' }, { status: 'pending' }),
    ],
    unprepared: [],
  };

  it('says what reached whom and retries what is missing', () => {
    const onRetry = vi.fn();
    render(<TestApp><InvitationRecovery outcome={outcome} onRetry={onRetry} onClose={() => {}} /></TestApp>);

    expect(screen.getByText('Event published')).toBeInTheDocument();
    expect(screen.getByText('Private details reached 2 of 3 invitees.')).toBeInTheDocument();
    expect(screen.getByText('name-carol')).toBeInTheDocument();
    expect(screen.getByText(': timed out')).toBeInTheDocument();
    expect(screen.queryByText('name-alice')).not.toBeInTheDocument();
    expect(screen.getByText(/Your own copies of 1 delivered invitation weren't/)).toBeInTheDocument();
    expect(screen.getByText(/doesn't publish the event again/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Retry what's missing/ }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('only offers Close once every invitation went through', () => {
    const done: InvitationOutcome = { ...outcome, deliveries: [delivery('alice', { status: 'delivered', via: 'inbox' })] };
    render(<TestApp><InvitationRecovery outcome={done} onRetry={() => {}} onClose={() => {}} /></TestApp>);
    expect(screen.getByText('Private details reached 1 of 1 invitee.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
  });
});
