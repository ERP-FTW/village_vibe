import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import type { MessageDelivery } from '@/lib/dmDelivery';

const ME = 'a'.repeat(64);
const PARTNER = 'b'.repeat(64);

// Every relay read fails; the signer has no NIP-44, so only NIP-04 history is attempted
vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { query: async () => { throw new Error('relays down'); } } }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: ME, signer: { nip04: { decrypt: async () => '' } } } }),
}));
vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: { relayUrl: 'wss://relay.example' }, presetRelays: [] }),
}));

const { useConversations, useDirectMessages } = await import('./useDirectMessages');

const failed: MessageDelivery = {
  prepared: { protocol: 'nip04', sender: ME, recipient: PARTNER, text: 'see you at 6', event: { id: 'f'.repeat(64), created_at: 1_800_000_000 } as NostrEvent },
  recipient: { status: 'failed', error: 'timed out' },
  senderCopy: null,
};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['dm-outbox', ME], [failed]);
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('messages sent this session', () => {
  it('stay visible with their retry state when history reads fail', async () => {
    const { result } = renderHook(() => useDirectMessages(PARTNER), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toMatchObject({ content: 'see you at 6', isFromMe: true, delivery: failed });
  });

  it('keep a conversation started this session in the list when history reads fail', async () => {
    const { result } = renderHook(() => useConversations(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toEqual([{ pubkey: PARTNER, lastMessageAt: 1_800_000_000 }]);
  });
});
