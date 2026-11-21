import { describe, expect, it } from 'vitest';
import type { NostrEvent, NostrFilter, NPool } from '@nostrify/nostrify';
import { withVillageTags } from './contentTags';
import { LABEL_WINDOW, readVillageFeed } from './villageFeed';

const OWNER = 'b'.repeat(64);
const MODERATOR = 'c'.repeat(64);
const MEMBER = 'a'.repeat(64);
const STRANGER = 'd'.repeat(64);
const TRIBE = `34550:${OWNER}:garden`;

let nextId = 0;
function ev(pubkey: string, kind: number, tags: string[][], createdAt: number): NostrEvent {
  return { id: (nextId++).toString(16).padStart(64, '0'), pubkey, kind, tags, created_at: createdAt, content: '', sig: '' };
}

const tribe = ev(OWNER, 34550, [
  ['d', 'garden'], ['name', 'Garden'], ['p', OWNER, '', 'admin'], ['p', MODERATOR, '', 'moderator'], ['p', MEMBER, '', 'member'],
], 100);
/** A member's story with no village tags of its own: only a promotion can bring it in. */
const story = ev(MEMBER, 30023, [['d', 'seed-swap'], ['title', 'Seed swap'], ['a', TRIBE]], 500);

function promotion(by: string, address: string, villages: string[], createdAt: number, indexed: boolean) {
  const tags = [['a', address], ['l', 'village-promoted', 'promotion'], ['L', 'promotion'], ...villages.map(v => ['village', v])];
  return ev(by, 1985, indexed ? withVillageTags(tags, villages) : tags, createdAt);
}

/** Newer promotions elsewhere that push older ones out of a fixed recent window. */
const noise = (count: number) => Array.from({ length: count }, (_, i) =>
  promotion(STRANGER, `30023:${STRANGER}:other-${i}`, ['westside'], 10_000 + i, true));

/** NIP-01 matching over an in-memory store. Optionally rejects multi-letter tag filters. */
function fakePool(store: NostrEvent[], opts: { rejectMultiLetterTags?: boolean; ignoreMultiLetterTags?: boolean } = {}) {
  const matches = (event: NostrEvent, filter: NostrFilter) => {
    if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
    if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
    if (filter.since !== undefined && event.created_at < filter.since) return false;
    if (filter.until !== undefined && event.created_at > filter.until) return false;
    for (const [key, values] of Object.entries(filter)) {
      if (!key.startsWith('#')) continue;
      const name = key.slice(1);
      if (!event.tags.some(([n, v]) => n === name && (values as string[]).includes(v))) return false;
    }
    return true;
  };
  const pool = {
    async query(filters: NostrFilter[]) {
      if (opts.rejectMultiLetterTags && filters.some(f => Object.keys(f).some(k => /^#.{2,}/.test(k)))) {
        throw new Error('unsupported filter');
      }
      const found = new Map<string, NostrEvent>();
      for (const filter of filters) {
        // Some relays answer filters they don't support with nothing
        if (opts.ignoreMultiLetterTags && Object.keys(filter).some(k => /^#.{2,}/.test(k))) continue;
        store.filter(e => matches(e, filter))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, filter.limit ?? Infinity)
          .forEach(e => found.set(e.id, e));
      }
      return [...found.values()];
    },
  };
  return pool as unknown as NPool;
}

const stories = [{ kinds: [30023], limit: 50 }];
const read = (pool: NPool, pages?: number) => readVillageFeed(pool, ['eastside'], stories, new AbortController().signal, { promotionPages: pages });

describe('village promotion discovery', () => {
  it('finds an older indexed promotion beyond a full window of unrelated labels', async () => {
    const pool = fakePool([tribe, story, promotion(MODERATOR, `30023:${MEMBER}:seed-swap`, ['eastside'], 1_000, true), ...noise(LABEL_WINDOW + 50)]);

    const feed = await read(pool);
    expect(feed.events.map(e => e.id)).toEqual([story.id]);
    expect(feed.promotionsComplete).toBe(true);
  });

  it('finds an older legacy promotion through #village when the relay supports it', async () => {
    const pool = fakePool([tribe, story, promotion(MODERATOR, `30023:${MEMBER}:seed-swap`, ['eastside'], 1_000, false), ...noise(LABEL_WINDOW + 50)]);

    const feed = await read(pool);
    expect(feed.events.map(e => e.id)).toEqual([story.id]);
    expect(feed.promotionsComplete).toBe(true);
  });

  it('reports incomplete discovery when a relay rejects multi-letter filters, and finds it further back', async () => {
    const pool = fakePool(
      [tribe, story, promotion(MODERATOR, `30023:${MEMBER}:seed-swap`, ['eastside'], 1_000, false), ...noise(LABEL_WINDOW + 50)],
      { rejectMultiLetterTags: true },
    );

    const first = await read(pool);
    expect(first.events).toEqual([]);
    expect(first.promotionsComplete).toBe(false);

    const further = await read(pool, 2);
    expect(further.events.map(e => e.id)).toEqual([story.id]);
    expect(further.promotionsComplete).toBe(true);
  });

  it('keeps moderator authority: an older promotion by a non-moderator still admits nothing', async () => {
    const pool = fakePool([tribe, story, promotion(STRANGER, `30023:${MEMBER}:seed-swap`, ['eastside'], 1_000, true), ...noise(LABEL_WINDOW + 50)]);

    const feed = await read(pool, 3);
    expect(feed.events).toEqual([]);
  });

  it('is complete when every label source was read to the end', async () => {
    const pool = fakePool([tribe, story, promotion(MODERATOR, `30023:${MEMBER}:seed-swap`, ['eastside'], 1_000, true), ...noise(10)]);

    const feed = await read(pool);
    expect(feed.promotionsComplete).toBe(true);
    expect(feed.events.map(e => e.id)).toEqual([story.id]);
  });

  it('keeps the recent fallback when a relay answers #village with nothing', async () => {
    const pool = fakePool(
      [tribe, story, promotion(MODERATOR, `30023:${MEMBER}:seed-swap`, ['eastside'], 1_000, false), ...noise(LABEL_WINDOW + 50)],
      { ignoreMultiLetterTags: true },
    );

    const first = await read(pool);
    expect(first.events).toEqual([]);
    expect(first.promotionsComplete).toBe(false);
    expect(first.promotionsCanReadFurther).toBe(true);

    const further = await read(pool, 2);
    expect(further.events.map(e => e.id)).toEqual([story.id]);
  });

  it('stays incomplete after skipping a second that holds more labels than a window', async () => {
    // 200 promotions in one second fill every window at that second; the story's is the 201st
    const crowded = Array.from({ length: LABEL_WINDOW }, (_, i) =>
      promotion(STRANGER, `30023:${STRANGER}:crowd-${i}`, ['eastside'], 1_000, true));
    const pool = fakePool([tribe, story, ...crowded, promotion(MODERATOR, `30023:${MEMBER}:seed-swap`, ['eastside'], 1_000, true)]);

    const feed = await read(pool, 4);
    expect(feed.events).toEqual([]);
    expect(feed.promotionsComplete).toBe(false);
    expect(feed.promotionsCanReadFurther).toBe(false);
  });
});
