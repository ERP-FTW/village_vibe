import type { NostrEvent } from "@nostrify/nostrify";
import { useAuthor } from "@/hooks/useAuthor";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { genUserName } from "@/lib/genUserName";
import type { RSVPStatus } from "@/lib/rsvp";

interface EventDiscussionRSVPProps {
  comment: NostrEvent;
  rsvpStatus: RSVPStatus;
}

const statusConfig = {
  accepted: { variant: 'default' as const, emoji: '✅', text: 'Going' },
  tentative: { variant: 'secondary' as const, emoji: '🤔', text: 'Maybe' },
  declined: { variant: 'outline' as const, emoji: '❌', text: 'Not going' },
};

/**
 * A discussion reply that reads like an RSVP. Shown to the host for information only:
 * an RSVP (kind 31925) speaks for its signer, so the host cannot publish one on the
 * commenter's behalf.
 */
export function EventDiscussionRSVP({ comment, rsvpStatus }: EventDiscussionRSVPProps) {
  const author = useAuthor(comment.pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name || metadata?.display_name || genUserName(comment.pubkey);
  const config = statusConfig[rsvpStatus];

  return (
    <Card className="border-dashed">
      <CardContent className="flex items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarImage src={metadata?.picture} alt={displayName} />
            <AvatarFallback className="text-xs">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{displayName}</div>
            <div className="truncate text-xs text-muted-foreground">
              "{comment.content.slice(0, 80)}{comment.content.length > 80 ? '…' : ''}"
            </div>
          </div>
        </div>
        <Badge variant={config.variant} className="shrink-0 text-xs">
          {config.emoji} {config.text}
        </Badge>
      </CardContent>
    </Card>
  );
}
