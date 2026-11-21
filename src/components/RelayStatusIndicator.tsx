import { useAppContext } from "@/hooks/useAppContext";
import { Wifi } from "lucide-react";

/**
 * Small inline indicator showing active relays
 */
export function RelayStatusIndicator() {
  const { config } = useAppContext();
  
  const activeRelays = [
    config.relayUrl,
    'wss://ditto.pub/relay',
    'wss://relay.damus.io',
  ].filter((url, index, self) => self.indexOf(url) === index); // Remove duplicates
  
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Wifi className="h-3 w-3" />
      <span>Querying {activeRelays.length} relays</span>
    </div>
  );
}
