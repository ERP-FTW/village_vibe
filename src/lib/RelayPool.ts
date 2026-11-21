import { NPool, NSet, type NPoolOpts, type NRelay, type NostrEvent, type NostrFilter } from '@nostrify/nostrify';
import { getFilterLimit } from 'nostr-tools';

/** Hard upper bound for any read. */
const QUERY_TIMEOUT_MS = 5000;
/** Once a relay has completed and matches exist, wait this long for stragglers. */
const RELAY_GRACE_MS = 300;
/**
 * Once a relay has completed with no matches, wait this long for a slower relay
 * to produce one before accepting the empty answer.
 */
const EMPTY_GRACE_MS = 2000;

export function readRelayUrls(primary: string, presets: { url: string }[] = []) {
  const urls = new Set([primary, 'wss://ditto.pub/relay', 'wss://relay.damus.io']);
  const extra = presets.find(({ url }) => !urls.has(url));
  if (extra) urls.add(extra.url);
  return [...urls];
}

/**
 * NPool whose `query` resolves shortly after the first relay completes instead of
 * waiting for the slowest one, and which reports failure only when no relay answered.
 *
 * Outcomes:
 * - matches found: resolve RELAY_GRACE_MS after a relay completes (or when all complete)
 * - no matches, at least one relay completed: resolve `[]` (after EMPTY_GRACE_MS at most)
 * - no matches, no relay completed (all closed, failed or timed out): reject
 * - caller's signal aborted: reject with the caller's reason
 */
export class RelayPool extends NPool {
  constructor(private readonly routing: NPoolOpts<NRelay>) {
    super(routing);
  }

  override async query(filters: NostrFilter[], opts: { signal?: AbortSignal; relays?: string[] } = {}) {
    opts.signal?.throwIfAborted();
    if (filters.every(filter => getFilterLimit(filter) === 0)) return [];

    const routes = opts.relays
      ? new Map(opts.relays.map(url => [url, filters]))
      : await this.routing.reqRouter(filters);
    const stop = new AbortController();
    const signal = opts.signal ? AbortSignal.any([stop.signal, opts.signal]) : stop.signal;
    const timeout = setTimeout(() => stop.abort(new DOMException('Relay query timed out', 'TimeoutError')), QUERY_TIMEOUT_MS);
    let grace: ReturnType<typeof setTimeout> | undefined;
    let emptyGrace: ReturnType<typeof setTimeout> | undefined;
    const storage = new Map<string, NostrEvent>();
    const events = new NSet(storage);
    let completed = 0;

    const settleSoon = () => {
      if (!completed) return;
      if (events.size) {
        if (grace === undefined) grace = setTimeout(() => stop.abort(), RELAY_GRACE_MS);
      } else if (emptyGrace === undefined) {
        emptyGrace = setTimeout(() => stop.abort(), EMPTY_GRACE_MS);
      }
    };

    try {
      // NPool.req only emits the pooled EOSE. Each subscription here sees its own.
      const reads = Array.from(routes, async ([url, routedFilters]) => {
        for await (const message of this.relay(url).req(routedFilters, { signal })) {
          if (message[0] === 'EVENT') {
            if (!events.has(message[2])) events.add(message[2]);
            settleSoon();
          }
          if (message[0] === 'EOSE') {
            completed++;
            settleSoon();
            return;
          }
        }
        throw new Error(`${url} closed the subscription before completing`);
      });
      await Promise.allSettled(reads);
      opts.signal?.throwIfAborted();
      if (!events.size && !completed) {
        stop.signal.throwIfAborted();
        throw new Error('No relay completed the query');
      }
      return filters.some(filter => typeof filter.search === 'string') ? [...storage.values()] : [...events.values()];
    } finally {
      clearTimeout(timeout);
      clearTimeout(grace);
      clearTimeout(emptyGrace);
      stop.abort();
    }
  }
}
