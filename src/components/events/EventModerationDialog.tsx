import { useCreateEventLabel, usePromoteEventToVillages } from '@/hooks/useEvents';
import { ModerationDialog } from '@/components/moderation/ModerationDialog';
import { MODERATION_LABELS } from '@/lib/moderationLabels';
import type { NostrEvent } from '@nostrify/nostrify';

interface EventModerationDialogProps {
  children: React.ReactNode;
  event: NostrEvent;
  villageSlug?: string;
  onPromote?: () => void;
}

export function EventModerationDialog({ children, event, villageSlug, onPromote }: EventModerationDialogProps) {
  const { mutateAsync: createLabel, isPending: isCreatingLabel } = useCreateEventLabel();
  const { mutateAsync: promoteToVillages, isPending: isPromoting } = usePromoteEventToVillages();

  const eventId = `${event.pubkey}:${event.tags.find(([name]) => name === 'd')?.[1]}`;
  const eventTitle = event.tags.find(([name]) => name === 'title')?.[1] || 'Untitled Event';

  return (
    <ModerationDialog
      noun="event"
      authorPubkey={event.pubkey}
      villageSlug={villageSlug}
      isPending={isCreatingLabel || isPromoting}
      onPromote={onPromote}
      summary={
        <>
          <h4 className="font-medium text-sm truncate">{eventTitle}</h4>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{event.content}</p>
        </>
      }
      onAction={async (action, reason) => {
        if (action === 'promote' && villageSlug) {
          await promoteToVillages({ event, villages: [villageSlug], reason });
          return;
        }
        if (event.kind !== 36959 && event.kind !== 31923) throw new Error('Unsupported event kind');
        await createLabel({
          eventId,
          eventKind: event.kind,
          ...MODERATION_LABELS[action],
          villages: action !== 'hide' && villageSlug ? [villageSlug] : undefined,
          content: reason,
        });
      }}
    >
      {children}
    </ModerationDialog>
  );
}
