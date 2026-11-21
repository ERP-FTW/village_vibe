import { readRelayUrls } from '@/lib/RelayPool';
import { useAppContext } from "@/hooks/useAppContext";
import { Wifi } from "lucide-react";

/**
 * Small inline indicator showing active relays
 */
export function RelayStatusIndicator() {
  const { config, presetRelays } = useAppContext();
  
  const activeRelays = readRelayUrls(config.relayUrl, presetRelays);
  
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Wifi className="h-3 w-3" />
      <span>Querying {activeRelays.length} relays</span>
    </div>
  );
}
