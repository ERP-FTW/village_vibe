import { matchFilters } from 'nostr-tools';
import type { NostrEvent, NostrFilter, NPool } from '@nostrify/nostrify';
import { readVillageFeed } from './src/lib/villageFeed';
import { withVillageTags } from './src/lib/contentTags';
let n = 0;
const ev = (pubkey: string, tags: string[][]): NostrEvent => ({ id: `e${++n}`, kind: 30023, pubkey, tags, content: '', created_at: 100, sig: '' });
const fresh = ev('a'.repeat(64), [['d', 'new'], ...withVillageTags([], ['east'])]);
const legacy = ev('b'.repeat(64), [['d', 'old'], ['village', 'east']]);
const data = [fresh, legacy];
const mk = (mode: 'reject' | 'empty' | 'support') => ({ query: async (filters: NostrFilter[]) => {
  const multi = filters.some(f => Object.keys(f).some(k => k.startsWith('#') && k.length > 2));
  if (multi && mode === 'reject') throw new Error('CLOSED');
  if (multi && mode === 'empty') return [];
  return data.filter(e => filters.some(f => { const { ['#village']: v, ...rest } = f as NostrFilter & { '#village'?: string[] };
    return matchFilters([rest], e) && (!v || e.tags.some(([t, val]) => t === 'village' && v.includes(val))); }));
} }) as unknown as NPool;
for (const mode of ['support', 'reject', 'empty'] as const) {
  const r = await readVillageFeed(mk(mode), ['east'], [{ kinds: [30023], limit: 50 }], new AbortController().signal);
  const ids = (Array.isArray(r) ? r : (r as { events: NostrEvent[] }).events).map(e => e.id).sort().join(',');
  console.log(`legacy filter ${mode.padEnd(7)} ->`, ids, '(expect e1,e2)');
}
