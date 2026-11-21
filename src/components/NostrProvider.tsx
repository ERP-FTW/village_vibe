import React, { useEffect, useRef } from 'react';
import { NostrEvent, NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';
import { useQueryClient } from '@tanstack/react-query';
import { RelayPool, readRelayUrls } from '@/lib/RelayPool';
import { useAppContext } from '@/hooks/useAppContext';

interface NostrProviderProps {
  children: React.ReactNode;
}

const NostrProvider: React.FC<NostrProviderProps> = (props) => {
  const { children } = props;
  const { config, presetRelays } = useAppContext();

  // Create NPool instance only once
  const pool = useRef<NPool | undefined>(undefined);

  // Use refs so the pool always has the latest data
  const relayUrl = useRef<string>(config.relayUrl);

  const queryClient = useQueryClient();

  // Update refs when config changes; after a relay switch, refetch active queries so
  // pages showing "not found" or an empty list can recover from the new relay.
  useEffect(() => {
    if (relayUrl.current === config.relayUrl) return;
    relayUrl.current = config.relayUrl;
    void queryClient.invalidateQueries();
  }, [config.relayUrl, queryClient]);

  // Initialize NPool only once
  if (!pool.current) {
    pool.current = new RelayPool({
      open(url: string) {
        return new NRelay1(url);
      },
      reqRouter(filters) {
        return new Map(readRelayUrls(relayUrl.current, presetRelays).map(url => [url, filters]));
      },
      eventRouter(_event: NostrEvent) {
        // Publish to the selected relay and fallback relays
        const allRelays = new Set<string>([relayUrl.current]);

        // Always include Ditto for publishing
        allRelays.add('wss://ditto.pub/relay');

        // Also publish to the preset relays, capped to 5 total
        for (const { url } of (presetRelays ?? [])) {
          allRelays.add(url);

          if (allRelays.size >= 5) {
            break;
          }
        }

        return [...allRelays];
      },
    });
  }

  return (
    <NostrContext.Provider value={{ nostr: pool.current }}>
      {children}
    </NostrContext.Provider>
  );
};

export default NostrProvider;