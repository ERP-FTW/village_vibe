import { Globe } from 'lucide-react';
import type { PublicField } from '@/lib/publicFields';
import { cn } from '@/lib/utils';

interface PublicFieldsNoticeProps {
  /** What is being published, e.g. "this tribe". */
  subject: string;
  fields: PublicField[];
  /** Extra sentence about a setting that only affects this app (e.g. unlisted). */
  note?: string;
  className?: string;
}

/**
 * Shown before publishing: lists every field that goes to Nostr relays in the clear, so
 * nobody mistakes an app setting (unlisted, visibility) for confidentiality.
 */
export function PublicFieldsNotice({ subject, fields, note, className }: PublicFieldsNoticeProps) {
  return (
    <div className={cn('rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-2', className)}>
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <Globe className="h-3.5 w-3.5" aria-hidden />
        Published publicly on Nostr
      </p>
      <p>
        Anyone reading a relay or using another Nostr app can see these parts of {subject}:
      </p>
      <ul className="list-disc pl-5 space-y-0.5">
        {fields.map(field => <li key={field.label}>{field.label}</li>)}
      </ul>
      {note && <p>{note}</p>}
      <p>Only direct messages are encrypted.</p>
    </div>
  );
}
