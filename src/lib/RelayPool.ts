import { NPool, NSet, type NPoolOpts, type NRelay, type NostrEvent, type NostrFilter } from '@nostrify/nostrify';
import { getFilterLimit } from 'nostr-tools';

const QUERY_TIMEOUT_MS = 5000;
const RELAY_GRACE_MS = 300;

export function readRelayUrls(primary: string, presets: { url: string }[] = []) {
  const urls = new Set([primary, 'wss://ditto.pub/relay', 'wss://relay.damus.io']);
  const extra = presets.find(({ url }) => !urls.has(url));
  if (extra) urls.add(extra.url);
  return [...urls];
}

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
    signal.throwIfAborted();
    const timeout = setTimeout(() => stop.abort(new DOMException('Relay query timed out', 'TimeoutError')), QUERY_TIMEOUT_MS);
    let grace: ReturnType<typeof setTimeout> | undefined;
    const storage = new Map<string, NostrEvent>();
    const events = new NSet(storage);
    let completed = false;
    // An early empty relay cannot establish that the remaining relays have no match.
    const finishSoonIfReady = () => {
      if (completed && events.size && grace === undefined) {
        grace = setTimeout(() => stop.abort(), RELAY_GRACE_MS);
      }
    };

    try {
      // NPool.req only emits the pooled EOSE. Each subscription here sees its own.
      const reads = Array.from(routes, async ([url, routedFilters]) => {
        for await (const message of this.relay(url).req(routedFilters, { signal })) {
          if (message[0] === 'EVENT') {
            if (!events.has(message[2])) events.add(message[2]);
            finishSoonIfReady();
          }
          if (message[0] === 'EOSE') {
            completed = true;
            finishSoonIfReady();
            return;
          }
          if (message[0] === 'CLOSED') break;
        }
        throw new Error('Relay closed before completing its response');
      });
      const outcomes = await Promise.allSettled(reads);
      opts.signal?.throwIfAborted();
      if (!events.size && (!outcomes.length || outcomes.some(result => result.status === 'rejected'))) {
        signal.throwIfAborted();
        throw new Error('Relay query did not complete');
      }
      return filters.some(filter => typeof filter.search === 'string') ? [...storage.values()] : [...events.values()];
    } finally {
      clearTimeout(timeout);
      clearTimeout(grace);
      stop.abort();
    }
  }
}
