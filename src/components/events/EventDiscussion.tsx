import type { NostrEvent } from "@nostrify/nostrify";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useEventDiscussion } from "@/hooks/useEventDiscussion";
import { EventDiscussionRSVP } from "./EventDiscussionRSVP";
import { EventDiscussionForm } from "./EventDiscussionForm";
import { EventDiscussionList } from "./EventDiscussionList";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { detectRSVPStatus } from "@/lib/rsvp";

interface EventDiscussionProps {
  event: NostrEvent;
}

export function EventDiscussion({ event }: EventDiscussionProps) {
  const { user } = useCurrentUser();
  const { data: discussionData, isLoading } = useEventDiscussion(event);

  // Check if user is the event host
  const isHost = user?.pubkey === event.pubkey;

  // Get RSVP comments for admin review
  const rsvpComments = discussionData?.allComments?.filter(comment => {
    const status = detectRSVPStatus(comment.content);
    return status !== null && comment.pubkey !== event.pubkey; // Exclude event host's own messages
  }) || [];

  const comments = discussionData?.topLevelComments || [];

  return (
    <div className="space-y-6">
      {isHost && rsvpComments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              🎫 Informal RSVP replies
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              These replies read like RSVPs. Only each person can publish their own RSVP, so they are shown here as informal replies.
            </p>
            <div className="space-y-3">
              {rsvpComments.map((comment) => {
                const status = detectRSVPStatus(comment.content);
                if (!status) return null;

                return (
                  <EventDiscussionRSVP
                    key={comment.id}
                    comment={comment}
                    rsvpStatus={status}
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      <div className="space-y-6">
        <EventDiscussionForm event={event} />
        <EventDiscussionList
          comments={comments}
          isLoading={isLoading}
          getDirectReplies={discussionData?.getDirectReplies}
        />
      </div>
    </div>
  );
}