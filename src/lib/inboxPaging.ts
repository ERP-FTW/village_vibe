import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

/** The query interface inbox paging needs (satisfied by the app's relay pool). */
export interface InboxQueryable {
  query(filters: NostrFilter[], opts: { signal?: AbortSignal; relays?: string[] }): Promise<NostrEvent[]>;
}

/** NIP-59 backdates wrap timestamps by up to two days; the recent window is read in full. */
export const RANDOMIZED_WINDOW_S = 3 * 24 * 60 * 60;
export const PAGE_SIZE = 300;
/** Pages read per relay on each refresh of the recent window (raised on request). */
export const MAX_RECENT_PAGES = 5;
/** Upper bound for that budget, however often more is requested. */
export const RECENT_PAGES_CAP = 25;

/** Where reading a relay's history stands. */
export interface RelayCursor {
  relay: string;
  /** Inclusive `until` to continue reading older wraps from; undefined once nothing older is left. */
  nextUntil?: number;
  /**
   * Reading stopped before the end (read pages are kept), and continuing can close it:
   * - 'page-limit': the per-refresh page budget ran out (continue with "load older"),
   * - 'error': a request failed (continue to retry).
   */
  gap?: 'page-limit' | 'error';
  error?: string;
  /**
   * More than a page of wraps shared one timestamp, and a relay can't page within a single
   * second, so some at that second couldn't be listed. Unlike `gap` this is a record of
   * wraps that were passed over, not a place to continue from: no later read clears it.
   */
  skippedTimestamp?: true;
  /**
   * The refresh couldn't read the recent window in full (page budget or a failed request),
   * so `nextUntil` is a place inside the window. The next refresh continues it; reading
   * older history must not start from here.
   */
  windowIncomplete?: true;
}

export interface InboxRead {
  wraps: NostrEvent[];
  cursors: RelayCursor[];
}

/** True when every relay's history was read to the end with nothing skipped. */
export function historyComplete(cursors: RelayCursor[]): boolean {
  return cursors.every(cursor => cursor.nextUntil === undefined && !cursor.gap && !cursor.skippedTimestamp);
}

interface PageResult {
  fresh: NostrEvent[];
  /** Inclusive cursor for the next page, or undefined when this page was the last. */
  nextUntil?: number;
  /** Set when the cursor had to skip past a timestamp holding more than a page of wraps. */
  skippedTimestamp?: boolean;
}

/**
 * One page, newest first, from `until` (inclusive) back to `since`. Paging is inclusive so
 * wraps sharing the boundary timestamp aren't skipped; repeats are dropped by id. Only when
 * a full page can't move the cursor back (every wrap in it is at the `until` second) does
 * that second hold more wraps than the relay will list: then the cursor moves one second
 * back and the skip is reported. Whether the wraps were already known (e.g. from another
 * relay) doesn't matter.
 */
async function readPage(
  nostr: InboxQueryable, pubkey: string, relay: string, seen: Set<string>,
  range: { since?: number; until?: number }, signal?: AbortSignal,
): Promise<PageResult> {
  const batch = await nostr.query([{
    kinds: [1059], '#p': [pubkey], limit: PAGE_SIZE,
    ...(range.since !== undefined ? { since: range.since } : {}),
    ...(range.until !== undefined ? { until: range.until } : {}),
  }], { signal, relays: [relay] });
  const fresh = batch.filter(wrap => !seen.has(wrap.id));
  fresh.forEach(wrap => seen.add(wrap.id));
  if (batch.length < PAGE_SIZE) return { fresh };
  const oldest = Math.min(...batch.map(wrap => wrap.created_at));
  if (range.until !== undefined && oldest >= range.until) return { fresh, nextUntil: range.until - 1, skippedTimestamp: true };
  return { fresh, nextUntil: oldest };
}

function failure(cursor: RelayCursor, error: unknown, signal?: AbortSignal): RelayCursor {
  // An explicit cancellation is not a relay failure: let it reach the caller
  signal?.throwIfAborted();
  // Keeps `skippedTimestamp`: a failed request doesn't make passed-over wraps readable
  return { ...cursor, gap: 'error', error: error instanceof Error ? error.message : String(error) };
}

/**
 * Reads the recent window from each relay with its own cursor (relays hold different
 * histories and apply limits independently), then one page of older history. A failed
 * request keeps everything read before it and is reported on that relay's cursor. Only a
 * cancellation through `signal` rejects.
 */
export async function readRecentWraps(
  nostr: InboxQueryable, pubkey: string, relays: string[],
  options: { signal?: AbortSignal; now?: number; maxPages?: number } = {},
): Promise<InboxRead> {
  const { signal } = options;
  const maxPages = Math.min(options.maxPages ?? MAX_RECENT_PAGES, RECENT_PAGES_CAP);
  const since = (options.now ?? Math.floor(Date.now() / 1000)) - RANDOMIZED_WINDOW_S;
  const wraps = new Map<string, NostrEvent>();

  const readRelay = async (relay: string): Promise<RelayCursor> => {
    const seen = new Set<string>();
    let cursor: RelayCursor = { relay };
    let windowRead = false;
    let until: number | undefined;
    try {
      for (let page = 0; page < maxPages; page++) {
        const result = await readPage(nostr, pubkey, relay, seen, { since, until }, signal);
        result.fresh.forEach(wrap => wraps.set(wrap.id, wrap));
        if (result.skippedTimestamp) cursor = { ...cursor, skippedTimestamp: true };
        if (result.nextUntil === undefined) {
          windowRead = true;
          cursor = { ...cursor, nextUntil: since - 1 };
          break;
        }
        until = result.nextUntil;
        cursor = { ...cursor, nextUntil: until };
      }
      if (!windowRead) return { ...cursor, gap: 'page-limit', windowIncomplete: true };
    } catch (error) {
      return failure({ ...cursor, nextUntil: until, windowIncomplete: true }, error, signal);
    }
    // One page of history before the window
    return readOlder(nostr, pubkey, cursor, wraps, seen, signal);
  };

  const cursors = await Promise.all(relays.map(readRelay));
  return { wraps: [...wraps.values()], cursors };
}

async function readOlder(
  nostr: InboxQueryable, pubkey: string, cursor: RelayCursor,
  wraps: Map<string, NostrEvent>, seen: Set<string>, signal?: AbortSignal,
): Promise<RelayCursor> {
  if (cursor.nextUntil === undefined) return cursor;
  try {
    const result = await readPage(nostr, pubkey, cursor.relay, seen, { until: cursor.nextUntil }, signal);
    result.fresh.forEach(wrap => wraps.set(wrap.id, wrap));
    // A successful read closes a retry gap, never an earlier skip
    const next: RelayCursor = { relay: cursor.relay, nextUntil: result.nextUntil };
    return cursor.skippedTimestamp || result.skippedTimestamp ? { ...next, skippedTimestamp: true } : next;
  } catch (error) {
    return failure(cursor, error, signal);
  }
}

/**
 * Reads one more page from every relay that has older history left (or failed), continuing
 * from its cursor. Bounded: one request per relay per call.
 */
export async function readOlderWraps(
  nostr: InboxQueryable, pubkey: string, cursors: RelayCursor[], known: Iterable<string>, signal?: AbortSignal,
): Promise<InboxRead> {
  const wraps = new Map<string, NostrEvent>();
  const seen = new Set(known);
  const next = await Promise.all(cursors.map(cursor => readOlder(nostr, pubkey, cursor, wraps, seen, signal)));
  return { wraps: [...wraps.values()], cursors: next };
}

/**
 * The status to show per relay, combining the latest refresh of the recent window with any
 * older history loaded on request (which only ever extends beyond the window):
 * - a relay failing now, or a window the refresh couldn't read in full, is shown as is,
 *   since wraps can still arrive backdated anywhere in the window;
 * - otherwise the older-history cursor says how far back the relay has been read.
 * A crowded timestamp skipped by either read is kept either way.
 */
export function mergeCursors(recent: RelayCursor[], older?: RelayCursor[]): RelayCursor[] {
  return recent.map(cursor => {
    const stored = older?.find(o => o.relay === cursor.relay);
    if (!stored) return cursor;
    const merged = cursor.gap === 'error' || cursor.gap === 'page-limit' ? cursor : stored;
    return cursor.skippedTimestamp || stored.skippedTimestamp ? { ...merged, skippedTimestamp: true } : merged;
  });
}

/** Plain-language notes on what may be missing, for display. */
export function describeHistoryGaps(cursors: RelayCursor[]): string[] {
  const notes: string[] = [];
  for (const cursor of cursors) {
    const host = cursor.relay.replace(/^wss?:\/\//, '');
    if (cursor.gap === 'error') notes.push(`${host} didn't respond (${cursor.error ?? 'error'}).`);
    else if (cursor.gap === 'page-limit') notes.push(`Only part of the last few days was read from ${host}.`);
    if (cursor.skippedTimestamp) notes.push(`${host} has more messages with one timestamp than it can list; some may be missing.`);
  }
  return notes;
}
