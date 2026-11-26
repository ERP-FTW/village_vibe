import type { NostrEvent } from "@nostrify/nostrify";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { eventVisibility } from "@/lib/eventVisibility";
import { cn } from "@/lib/utils";

/**
 * Tells the people who are shown a restricted event that others are not. Nothing for a
 * public event. The wording is about what Village Vibe shows: the listing stays public.
 */
export function EventAudienceBadge({ event, className }: { event: NostrEvent; className?: string }) {
  const visibility = eventVisibility(event);
  if (visibility === 'public') return null;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 whitespace-nowrap", className)}
      title="Who Village Vibe shows this event to. The listing itself is public on Nostr."
    >
      <Lock className="h-3 w-3" aria-hidden="true" />
      {visibility === 'tribe-only' ? 'Tribe members' : 'Invited people'}
    </Badge>
  );
}
