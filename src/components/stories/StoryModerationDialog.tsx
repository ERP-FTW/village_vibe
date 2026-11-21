import { useCreateStoryLabel, usePromoteStoryToVillages } from '@/hooks/useStories';
import { ModerationDialog } from '@/components/moderation/ModerationDialog';
import { MODERATION_LABELS } from '@/lib/moderationLabels';
import type { NostrEvent } from '@nostrify/nostrify';

interface StoryModerationDialogProps {
  children: React.ReactNode;
  story: NostrEvent;
  villageSlug?: string;
  onPromote?: () => void;
}

export function StoryModerationDialog({ children, story, villageSlug, onPromote }: StoryModerationDialogProps) {
  const { mutateAsync: createLabel, isPending: isCreatingLabel } = useCreateStoryLabel();
  const { mutateAsync: promoteToVillages, isPending: isPromoting } = usePromoteStoryToVillages();

  const storyId = `${story.pubkey}:${story.tags.find(([name]) => name === 'd')?.[1]}`;
  const storyTitle = story.tags.find(([name]) => name === 'title')?.[1] || 'Untitled Story';

  return (
    <ModerationDialog
      noun="story"
      authorPubkey={story.pubkey}
      villageSlug={villageSlug}
      isPending={isCreatingLabel || isPromoting}
      onPromote={onPromote}
      summary={<h4 className="font-medium text-sm truncate">{storyTitle}</h4>}
      onAction={async (action, reason) => {
        if (action === 'promote' && villageSlug) {
          await promoteToVillages({ story, villages: [villageSlug], reason });
          return;
        }
        await createLabel({
          storyId,
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
