import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const ME = 'a'.repeat(64);
const PARTNER = 'b'.repeat(64);
const RELAY = 'wss://relay.example';
const now = () => Math.floor(Date.now() / 1000);
const wrap = (id: string, createdAt: number): NostrEvent => ({
  id: id.padStart(64, '0'), pubkey: 'e'.repeat(64), kind: 1059, created_at: createdAt, tags: [], content: `wrap-${id}`, sig: '',
});

/** Session state is kept per viewer, so each test reads as its own viewer. */
let viewer = ME;
let relaysDown = false;
/** Fail this many more gift wrap (kind 1059) requests to RELAY. */
let failWrapRequests = 0;
/** Gift wraps held by RELAY; the app's other default relays hold none. */
let wraps: NostrEvent[] = [1, 2, 3].map(i => wrap(String(i), now() - i * 60));

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({
    nostr: {
      async query(filters: { kinds?: number[]; since?: number; until?: number; limit?: number }[], opts?: { relays?: string[] }) {
        if (relaysDown) throw new Error('relays down');
        const [filter] = filters;
        if (!filter.kinds?.includes(1059) || (opts?.relays && !opts.relays.includes(RELAY))) return [];
        if (failWrapRequests > 0 && failWrapRequests--) throw new Error('relay timed out');
        return wraps
          .filter(w => (filter.since === undefined || w.created_at >= filter.since) && (filter.until === undefined || w.created_at <= filter.until))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, filter.limit);
      },
    },
  }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: { pubkey: viewer, signer: { nip44: {} } } }) }));
vi.mock('@/hooks/useAppContext', () => ({ useAppContext: () => ({ config: { relayUrl: RELAY }, presetRelays: [] }) }));
// Opening wraps needs real NIP-44; here each wrap opens to a message from PARTNER
vi.mock('@/lib/nip17', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/nip17')>(),
  supportsNip17: () => true,
  unwrapDirectMessage: async (_signer: unknown, wrap: NostrEvent) => ({
    id: `rumor-${wrap.id}`, pubkey: PARTNER, created_at: wrap.created_at, kind: 14, tags: [['p', ME]], content: wrap.content,
  }),
}));

const { useGiftWrappedInbox, useLoadOlderMessages } = await import('./useDirectMessages');

function newWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('gift-wrapped inbox refresh', () => {
  it('keeps messages already read when every relay fails on a later refresh', async () => {
    const { result } = renderHook(() => useGiftWrappedInbox(), { wrapper: newWrapper() });

    await waitFor(() => expect(result.current.data?.rumors).toHaveLength(3));

    relaysDown = true;
    await result.current.refetch();
    await waitFor(() => expect(result.current.data?.history.complete).toBe(false));
    expect(result.current.data?.rumors).toHaveLength(3);
    expect(result.current.data?.history.notes.join(' ')).toMatch(/didn't respond/);
  });

  it('reaches all older history after a relay that failed its first request recovers', async () => {
    viewer = 'c'.repeat(64);
    relaysDown = false;
    // 450 wraps from before the recent window (4+ days old)
    wraps = Array.from({ length: 450 }, (_, i) => wrap(`old-${i}`, now() - 4 * 86_400 - i));
    failWrapRequests = 1;

    const { result } = renderHook(() => ({ inbox: useGiftWrappedInbox(), older: useLoadOlderMessages() }), { wrapper: newWrapper() });
    await waitFor(() => expect(result.current.inbox.data?.history.notes.join(' ')).toMatch(/didn't respond/));

    // "Load older" while the relay is failing; the relay has recovered by the refresh after it
    await act(() => result.current.older.mutateAsync(result.current.inbox.data!.cursors));
    await waitFor(() => expect(result.current.inbox.data?.rumors).toHaveLength(300));

    await act(() => result.current.older.mutateAsync(result.current.inbox.data!.cursors));
    await waitFor(() => expect(result.current.inbox.data?.rumors).toHaveLength(450));
    expect(result.current.inbox.data?.history.complete).toBe(true);
  });
});
