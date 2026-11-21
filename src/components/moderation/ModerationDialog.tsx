import { useState, type ReactNode } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
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
import { Settings, Eye, EyeOff, Star, Loader2 } from 'lucide-react';
import type { ModerationAction } from '@/lib/moderationLabels';

interface ModerationDialogProps {
  children: ReactNode;
  /** What is being moderated, e.g. "story" (used in copy). */
  noun: string;
  /** Short description of the item shown at the top of the dialog. */
  summary: ReactNode;
  authorPubkey: string;
  /** Village the item can be promoted or featured in; promote/feature are hidden without it. */
  villageSlug?: string;
  isPending: boolean;
  onAction: (action: ModerationAction, reason: string | undefined) => Promise<void>;
  onPromote?: () => void;
}

/** Shared moderation dialog for stories, events and services. */
export function ModerationDialog({
  children, noun, summary, authorPubkey, villageSlug, isPending, onAction, onPromote,
}: ModerationDialogProps) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const run = async (action: ModerationAction) => {
    if (!user) {
      toast({ title: 'Login required', description: `Please log in to moderate this ${noun}.`, variant: 'destructive' });
      return;
    }
    try {
      await onAction(action, reason.trim() || undefined);
      toast({ title: 'Moderation action published' });
      if (action === 'promote') onPromote?.();
      setOpen(false);
      setReason('');
    } catch (error) {
      console.error('Moderation error:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
        variant: 'destructive',
      });
    }
  };

  const actionButton = (action: ModerationAction, icon: ReactNode, text: string) => (
    <Button variant="outline" className="w-full justify-start" onClick={() => run(action)} disabled={isPending}>
      {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : icon}
      {text}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 capitalize">
            <Settings className="h-5 w-5" />
            Moderate {noun}
          </DialogTitle>
          <DialogDescription>Manage how this {noun} appears in the tribe and village</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <Card className="bg-muted/50">
            <CardContent className="p-4">
              {summary}
              <p className="text-xs text-muted-foreground mt-1">by {authorPubkey.slice(0, 8)}...</p>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <Label htmlFor="moderation-reason">Reason (Optional)</Label>
            <Textarea
              id="moderation-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why you're taking this action..."
              rows={3}
            />
          </div>

          <Separator />

          <div className="space-y-3">
            <h4 className="font-medium text-sm">Actions</h4>
            <div className="space-y-2">
              {actionButton('hide', <EyeOff className="h-4 w-4 mr-2" />, 'Hide from Tribe Feed')}
              {villageSlug && actionButton('promote', <Eye className="h-4 w-4 mr-2" />, 'Promote to Village')}
              {villageSlug && actionButton('feature', <Star className="h-4 w-4 mr-2" />, 'Feature in Village')}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
