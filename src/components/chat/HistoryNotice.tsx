import { History, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { InboxHistory } from '@/hooks/useDirectMessages';
import { cn } from '@/lib/utils';

interface HistoryNoticeProps {
  history: InboxHistory;
  onLoadOlder: () => void;
  loading?: boolean;
  className?: string;
}

/** Says when message history is capped or partly unreadable, instead of presenting it as complete. */
export function HistoryNotice({ history, onLoadOlder, loading, className }: HistoryNoticeProps) {
  if (history.complete) return null;
  return (
    <div role="status" className={cn('rounded-md border border-dashed p-3 text-xs text-muted-foreground space-y-2', className)}>
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <History className="h-3.5 w-3.5" aria-hidden />
        Older messages may be missing
      </p>
      {history.notes.length > 0 && (
        <ul className="list-disc pl-5 space-y-0.5">
          {history.notes.map(note => <li key={note}>{note}</li>)}
        </ul>
      )}
      {history.canLoadOlder && (
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={onLoadOlder} disabled={loading}>
          {loading && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          Load older messages
        </Button>
      )}
    </div>
  );
}
