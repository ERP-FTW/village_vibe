import { useState } from 'react';
import { useCreateStoryLabel, usePromoteStoryToVillages } from '@/hooks/useStories';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/useToast';
import { Settings, Eye, EyeOff, Star, Loader2 } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

interface StoryModerationDialogProps {
  children: React.ReactNode;
  story: NostrEvent;
  villageSlug?: string;
  onPromote?: () => void;
}

export function StoryModerationDialog({
  children,
  story,
  villageSlug,
  onPromote
}: StoryModerationDialogProps) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { mutateAsync: createLabel, isPending: isCreatingLabel } = useCreateStoryLabel();
  const { mutateAsync: promoteToVillages, isPending: isPromoting } = usePromoteStoryToVillages();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const storyId = `${story.pubkey}:${story.tags.find(([name]) => name === 'd')?.[1]}`;
  const storyTitle = story.tags.find(([name]) => name === 'title')?.[1] || 'Untitled Story';

  const handleModeration = async (action: 'hide' | 'promote' | 'feature') => {
    if (!user) {
      toast({
        title: "Login required",
        description: "Please log in to moderate stories.",
        variant: "destructive",
      });
      return;
    }

    try {
      if (action === 'promote' && villageSlug) {
        await promoteToVillages({ story, villages: [villageSlug], reason: reason.trim() || undefined });
      } else {
        const labels = { hide: 'tribe-hidden', promote: 'village-promoted', feature: 'village-featured' };
        await createLabel({
          storyId,
          label: labels[action],
          namespace: action === 'hide' ? 'moderation' : 'promotion',
          content: reason.trim() || undefined,
        });
      }
      toast({ title: 'Moderation action published' });
      if (action === 'promote') onPromote?.();
      setOpen(false);
      setReason('');
    } catch (error) {
      console.error('Moderation error:', error);
      toast({
        title: "Error",
        description: "An unexpected error occurred.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Moderate Story
          </DialogTitle>
          <DialogDescription>
            Manage how this story appears in the tribe and village
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Story info */}
          <Card className="bg-muted/50">
            <CardContent className="p-4">
              <h4 className="font-medium text-sm truncate">{storyTitle}</h4>
              <p className="text-xs text-muted-foreground mt-1">
                by {story.pubkey.slice(0, 8)}...
              </p>
            </CardContent>
          </Card>

          {/* Reason field */}
          <div className="space-y-2">
            <Label htmlFor="reason">Reason (Optional)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why you're taking this action..."
              rows={3}
            />
          </div>

          <Separator />

          {/* Moderation actions */}
          <div className="space-y-3">
            <h4 className="font-medium text-sm">Actions</h4>

            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => handleModeration('hide')}
                disabled={isCreatingLabel || isPromoting}
              >
                {(isCreatingLabel || isPromoting) ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <EyeOff className="h-4 w-4 mr-2" />
                )}
                Hide from Tribe Feed
              </Button>

              {villageSlug && (
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => handleModeration('promote')}
                  disabled={isCreatingLabel || isPromoting}
                >
                  {(isCreatingLabel || isPromoting) ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Eye className="h-4 w-4 mr-2" />
                  )}
                  Promote to Village
                </Button>
              )}

              {villageSlug && (
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => handleModeration('feature')}
                  disabled={isCreatingLabel || isPromoting}
                >
                  {(isCreatingLabel || isPromoting) ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Star className="h-4 w-4 mr-2" />
                  )}
                  Feature in Village
                </Button>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isCreatingLabel || isPromoting}
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}