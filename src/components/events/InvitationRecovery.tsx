import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { summarizeDeliveries } from '@/lib/dmDelivery';
import { invitationsComplete, type InvitationOutcome } from '@/lib/invitations';

function InviteeName({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  return <>{author.data?.metadata?.name ?? genUserName(pubkey)}</>;
}

interface InvitationRecoveryProps {
  outcome: InvitationOutcome;
  onRetry: () => void;
  onClose: () => void;
  retrying?: boolean;
}

/**
 * Shown after an event was published but not every invitation went through. Retrying sends
 * only what's missing; the event itself is not published again.
 */
export function InvitationRecovery({ outcome, onRetry, onClose, retrying }: InvitationRecoveryProps) {
  const { delivered, undelivered, copiesMissing } = summarizeDeliveries(outcome.deliveries);
  const total = outcome.deliveries.length + outcome.unprepared.length;
  const complete = invitationsComplete(outcome);

  return (
    <div className="space-y-4" role="status">
      <div className="space-y-1">
        <h3 className="font-semibold">Event published</h3>
        <p className="text-sm text-muted-foreground">
          Private details reached {delivered.length} of {total} invitee{total === 1 ? '' : 's'}.
        </p>
      </div>

      {(undelivered.length > 0 || outcome.unprepared.length > 0) && (
        <div className="space-y-1 text-sm">
          <p className="font-medium">Not delivered:</p>
          <ul className="list-disc pl-5 space-y-1">
            {undelivered.map(delivery => (
              <li key={delivery.prepared.recipient}>
                <InviteeName pubkey={delivery.prepared.recipient} />
                {delivery.recipient.status === 'failed' && <span className="text-muted-foreground">: {delivery.recipient.error}</span>}
              </li>
            ))}
            {outcome.unprepared.map(({ recipient, error }) => (
              <li key={recipient}>
                <InviteeName pubkey={recipient} />
                <span className="text-muted-foreground">: {error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {copiesMissing.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Your own copies of {copiesMissing.length} delivered invitation{copiesMissing.length === 1 ? '' : 's'} weren't
          saved, so they won't appear in your messages on other devices.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Retrying sends only what's missing and doesn't publish the event again. The signed messages are kept
        only while this page is open; until then, undelivered invitations also show in Messages with a Retry button.
      </p>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
          Close
        </Button>
        {!complete && (
          <Button type="button" className="flex-1" onClick={onRetry} disabled={retrying}>
            {retrying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
            Retry what's missing
          </Button>
        )}
      </div>
    </div>
  );
}
