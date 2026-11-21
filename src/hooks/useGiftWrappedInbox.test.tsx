import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const ME = 'a'.repeat(64);
const PARTNER = 'b'.repeat(64);
let relaysDown = false;
const wraps: NostrEvent[] = [1, 2, 3].map(i => ({
  id: String(i).padStart(64, '0'), pubkey: 'e'.repeat(64), kind: 1059, created_at: Math.floor(Date.now() / 1000) - i * 60,
  tags: [['p', ME]], content: `wrap-${i}`, sig: '',
}));

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({
    nostr: {
      async query(filters: { kinds?: number[]; until?: number }[]) {
        if (relaysDown) throw new Error('relays down');
        const [filter] = filters;
        if (filter.kinds?.includes(1059)) return wraps.filter(w => filter.until === undefined || w.created_at <= filter.until);
        return [];
      },
    },
  }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: { pubkey: ME, signer: { nip44: {} } } }) }));
vi.mock('@/hooks/useAppContext', () => ({ useAppContext: () => ({ config: { relayUrl: 'wss://relay.example' }, presetRelays: [] }) }));
// Opening wraps needs real NIP-44; here each wrap opens to a message from PARTNER
vi.mock('@/lib/nip17', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/nip17')>(),
  supportsNip17: () => true,
  unwrapDirectMessage: async (_signer: unknown, wrap: NostrEvent) => ({
    id: `rumor-${wrap.id}`, pubkey: PARTNER, created_at: wrap.created_at, kind: 14, tags: [['p', ME]], content: wrap.content,
  }),
}));

const { useGiftWrappedInbox } = await import('./useDirectMessages');

describe('gift-wrapped inbox refresh', () => {
  it('keeps messages already read when every relay fails on a later refresh', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useGiftWrappedInbox(), { wrapper });

    await waitFor(() => expect(result.current.data?.rumors).toHaveLength(3));

    relaysDown = true;
    await result.current.refetch();
    await waitFor(() => expect(result.current.data?.history.complete).toBe(false));
    expect(result.current.data?.rumors).toHaveLength(3);
    expect(result.current.data?.history.notes.join(' ')).toMatch(/didn't respond/);
  });
});
