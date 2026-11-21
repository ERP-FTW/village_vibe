import { describe, expect, it } from 'vitest';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import {
  historyComplete, MAX_RECENT_PAGES, mergeCursors, PAGE_SIZE, RANDOMIZED_WINDOW_S, readOlderWraps, readRecentWraps,
  type InboxQueryable,
} from './inboxPaging';

const NOW = 1_800_000_000;
const SINCE = NOW - RANDOMIZED_WINDOW_S;
const ME = 'me';

function wrap(id: string, createdAt: number): NostrEvent {
  return { id, created_at: createdAt, kind: 1059, pubkey: 'x', tags: [['p', ME]], content: '', sig: '' };
}

/** `count` wraps on one relay, one per `step` seconds going back from `start`. */
function series(prefix: string, count: number, start: number, step = 1): NostrEvent[] {
  return Array.from({ length: count }, (_, i) => wrap(`${prefix}-${i}`, start - i * step));
}

/**
 * In-memory relays answering like NIP-01: newest first, `limit` per request, inclusive
 * `since`/`until`. `fail(relay, call)` makes a request throw.
 */
function fakeRelays(stores: Record<string, NostrEvent[]>, fail: (relay: string, call: number) => boolean = () => false) {
  const calls: Record<string, number> = {};
  const nostr: InboxQueryable = {
    async query(filters: NostrFilter[], opts) {
      opts.signal?.throwIfAborted();
      const relay = opts.relays![0];
      calls[relay] = (calls[relay] ?? 0) + 1;
      if (fail(relay, calls[relay])) throw new Error(`${relay} timed out`);
      const [filter] = filters;
      return (stores[relay] ?? [])
        .filter(event => (filter.since === undefined || event.created_at >= filter.since)
          && (filter.until === undefined || event.created_at <= filter.until))
        .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
        .slice(0, filter.limit);
    },
  };
  return { nostr, calls };
}

const ids = (events: NostrEvent[]) => new Set(events.map(event => event.id));

describe('reading the inbox', () => {
  it('keeps the first page when the second page fails, then resumes from the cursor', async () => {
    const store = series('a', 450, NOW - 10);
    const { nostr } = fakeRelays({ A: store }, (_relay, call) => call === 2);

    const read = await readRecentWraps(nostr, ME, ['A'], { now: NOW });
    expect(read.wraps).toHaveLength(PAGE_SIZE);
    expect(read.cursors[0]).toMatchObject({ gap: 'error', error: 'A timed out' });
    expect(historyComplete(read.cursors)).toBe(false);

    // The relay recovers: continuing from the cursor reads the rest without repeats
    const more = await readOlderWraps(nostr, ME, read.cursors, ids(read.wraps));
    expect(new Set([...ids(read.wraps), ...ids(more.wraps)]).size).toBe(450);
    expect(more.cursors[0].gap).toBeUndefined();
  });

  it('keeps recent messages when the older-history request fails', async () => {
    const { nostr } = fakeRelays({ A: [...series('recent', 20, NOW - 10), ...series('old', 5, SINCE - 100)] },
      (_relay, call) => call === 2);

    const read = await readRecentWraps(nostr, ME, ['A'], { now: NOW });
    expect(read.wraps).toHaveLength(20);
    expect(read.cursors[0]).toMatchObject({ gap: 'error', nextUntil: SINCE - 1 });

    const more = await readOlderWraps(nostr, ME, read.cursors, ids(read.wraps));
    expect(more.wraps).toHaveLength(5);
    expect(historyComplete(more.cursors)).toBe(true);
  });

  it('does not skip wraps that share the page-boundary timestamp', async () => {
    // 300 wraps, then 5 more at exactly the timestamp of the 300th
    const page = series('p', PAGE_SIZE, NOW - 10);
    const boundary = page[page.length - 1].created_at;
    const twins = Array.from({ length: 5 }, (_, i) => wrap(`twin-${i}`, boundary));
    const { nostr } = fakeRelays({ A: [...page, ...twins] });

    const read = await readRecentWraps(nostr, ME, ['A'], { now: NOW });
    expect(read.wraps).toHaveLength(PAGE_SIZE + 5);
    expect(historyComplete(read.cursors)).toBe(true);
  });

  it('terminates and reports a gap when more than a page shares one timestamp', async () => {
    const sameSecond = Array.from({ length: PAGE_SIZE + 50 }, (_, i) => wrap(`same-${String(i).padStart(3, '0')}`, NOW - 100));
    const older = series('older', 10, NOW - 200);
    const { nostr, calls } = fakeRelays({ A: [...sameSecond, ...older] });

    const read = await readRecentWraps(nostr, ME, ['A'], { now: NOW });
    expect(read.cursors[0].gap).toBe('same-timestamp');
    expect(calls.A).toBeLessThanOrEqual(MAX_RECENT_PAGES + 1);
    // Wraps below the crowded second are still read
    for (const event of older) expect(ids(read.wraps).has(event.id)).toBe(true);
    expect(historyComplete(read.cursors)).toBe(false);
  });

  it('marks the history incomplete past the page budget and finishes it with bounded loads', async () => {
    const store = series('a', PAGE_SIZE * 7, NOW - 10, 10);
    const { nostr } = fakeRelays({ A: store });

    let read = await readRecentWraps(nostr, ME, ['A'], { now: NOW });
    expect(read.cursors[0].gap).toBe('page-limit');
    expect(historyComplete(read.cursors)).toBe(false);

    const seen = ids(read.wraps);
    let loads = 0;
    while (!historyComplete(read.cursors) && loads < 10) {
      read = await readOlderWraps(nostr, ME, read.cursors, seen);
      read.wraps.forEach(event => seen.add(event.id));
      loads++;
    }
    expect(seen.size).toBe(store.length);
    expect(loads).toBeLessThan(10);
  });

  it('pages relays with unequal histories independently and drops duplicates by id', async () => {
    const shared = wrap('shared', NOW - 5);
    const { nostr } = fakeRelays({
      A: [shared, ...series('a', 600, NOW - 10)],
      B: [shared, ...series('b', 20, NOW - 2 * 86_400)],
      C: [],
    }, relay => relay === 'C');

    const read = await readRecentWraps(nostr, ME, ['A', 'B', 'C'], { now: NOW });
    expect(read.wraps).toHaveLength(1 + 600 + 20);
    expect(read.cursors.find(c => c.relay === 'C')).toMatchObject({ gap: 'error' });
    expect(read.cursors.find(c => c.relay === 'A')?.gap).toBeUndefined();
  });

  it('rejects when the caller cancels instead of reporting a relay failure', async () => {
    const controller = new AbortController();
    const { nostr } = fakeRelays({ A: series('a', 450, NOW - 10) }, (_relay, call) => {
      if (call === 2) controller.abort(new DOMException('Left the page', 'AbortError'));
      return false;
    });

    await expect(readRecentWraps(nostr, ME, ['A'], { now: NOW, signal: controller.signal })).rejects.toThrow('Left the page');
  });

  it('reads the whole recent window when given a larger page budget', async () => {
    const store = series('a', PAGE_SIZE * 7, NOW - 10, 10);
    const { nostr } = fakeRelays({ A: store });

    const read = await readRecentWraps(nostr, ME, ['A'], { now: NOW, maxPages: MAX_RECENT_PAGES * 2 });
    expect(read.wraps).toHaveLength(store.length);
    expect(historyComplete(read.cursors)).toBe(true);
  });
});

describe('combining a refresh with older history read on request', () => {
  const done = { relay: 'A' };
  it('keeps a gap the latest refresh left, even if older history was read to the end before', () => {
    const merged = mergeCursors([{ relay: 'A', nextUntil: NOW - 5000, gap: 'page-limit' }], [done]);
    expect(merged[0]).toMatchObject({ gap: 'page-limit', nextUntil: NOW - 5000 });
    expect(historyComplete(merged)).toBe(false);
  });

  it('shows a relay failing now as failing', () => {
    expect(mergeCursors([{ relay: 'A', gap: 'error', error: 'down' }], [done])[0].gap).toBe('error');
  });

  it('uses the older-history cursor once the refresh read its window in full', () => {
    expect(mergeCursors([{ relay: 'A', nextUntil: SINCE - 1 }], [{ relay: 'A', nextUntil: SINCE - 9000 }])[0].nextUntil).toBe(SINCE - 9000);
    expect(historyComplete(mergeCursors([{ relay: 'A', nextUntil: SINCE - 1 }], [done]))).toBe(true);
  });

  it('keeps a crowded-timestamp gap the refresh found', () => {
    expect(mergeCursors([{ relay: 'A', nextUntil: SINCE - 1, gap: 'same-timestamp' }], [done])[0].gap).toBe('same-timestamp');
  });
});
