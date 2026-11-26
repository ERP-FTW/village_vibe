import type { RefObject } from "react";
import { nip19 } from "nostr-tools";
import { Lock, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useAuthor } from "@/hooks/useAuthor";
import type { EventVisibility } from "@/lib/eventVisibility";
import { genUserName } from "@/lib/genUserName";

/** The part of the event form these controls read and change. */
export interface EventAudience {
  visibility: EventVisibility;
  /** Hex pubkeys, each once. */
  invitees: string[];
  /** Sent only in the encrypted invitation, never published. */
  privateDetails: string;
  /** Sent only in the encrypted invitation, never published. */
  exactLocation: string;
  sendDMs: boolean;
}

interface EventAudienceFieldsProps {
  value: EventAudience;
  onChange: (patch: Partial<EventAudience>) => void;
  /** What is typed in the invite field and not added yet. */
  entry: string;
  onEntryChange: (entry: string) => void;
  /** Move the typed entry into the invitee list. */
  onAdd: () => void;
  /** What was wrong with the last entry, one sentence each. */
  problems: string[];
  inviteInputRef: RefObject<HTMLTextAreaElement>;
}

const AUDIENCES: Array<{ value: EventVisibility; label: string; hint: string }> = [
  { value: 'public', label: 'Everyone', hint: 'Shown to anyone, logged in or not.' },
  { value: 'tribe-only', label: 'Members of this tribe', hint: 'Village Vibe shows it only to the tribe\'s current members.' },
  { value: 'private', label: 'People I invite', hint: 'Village Vibe shows it only to the people you name below.' },
];

function Invitee({ pubkey, onRemove }: { pubkey: string; onRemove: () => void }) {
  const author = useAuthor(pubkey);
  const name = author.data?.metadata?.name ?? genUserName(pubkey);
  const npub = nip19.npubEncode(pubkey);
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
      <span className="min-w-0">
        <span className="block truncate font-medium">{name}</span>
        <span className="block truncate text-xs text-muted-foreground" title={npub}>{npub.slice(0, 12)}…{npub.slice(-6)}</span>
      </span>
      <Button type="button" variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0" aria-label={`Remove ${name}`} onClick={onRemove}>
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </li>
  );
}

/**
 * Who Village Vibe shows the event to, who is invited, and what only invitees are told.
 * The wording never promises a confidential event: the listing and the invitee list are
 * public on Nostr. Only the two fields in the lock box stay out of the published event.
 */
export function EventAudienceFields({ value, onChange, entry, onEntryChange, onAdd, problems, inviteInputRef }: EventAudienceFieldsProps) {
  const invited = value.visibility === 'private';
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label id="audience-label">Who Village Vibe shows this event to</Label>
        <RadioGroup
          value={value.visibility}
          onValueChange={(next) => onChange({ visibility: next as EventVisibility })}
          aria-labelledby="audience-label"
          aria-describedby="audience-hint"
          className="gap-3"
        >
          {AUDIENCES.map(option => (
            <div key={option.value} className="flex items-start gap-2">
              <RadioGroupItem id={`audience-${option.value}`} value={option.value} className="mt-0.5 shrink-0" />
              <label htmlFor={`audience-${option.value}`} className="cursor-pointer text-sm leading-tight">
                <span className="block font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.hint}</span>
              </label>
            </div>
          ))}
        </RadioGroup>
        <p id="audience-hint" className="text-xs text-muted-foreground">
          This is a display setting, not a confidential event. The listing (title, time, public location, description)
          and the list of people you invite are public on Nostr, and other apps can show them. Only what you send by
          direct message is encrypted.
        </p>
      </div>

      {invited && (
        <>
          <div className="space-y-2">
            <Label htmlFor="invitees">Invite people</Label>
            <div className="flex items-start gap-2">
              <Textarea
                id="invitees"
                ref={inviteInputRef}
                rows={2}
                value={entry}
                onChange={(e) => onEntryChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onAdd();
                  }
                }}
                placeholder="npub1…, nprofile1… or hex key"
                aria-describedby={problems.length ? 'invitees-hint invitees-problems' : 'invitees-hint'}
                aria-invalid={problems.length > 0}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-h-0"
              />
              <Button type="button" variant="outline" onClick={onAdd} className="shrink-0">
                <Plus className="h-4 w-4 sm:mr-1" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Add</span>
              </Button>
            </div>
            <p id="invitees-hint" className="text-xs text-muted-foreground">
              Paste one or several. The people you invite are named on the public listing.
            </p>
            {problems.length > 0 && (
              <ul id="invitees-problems" role="alert" className="space-y-0.5 text-xs text-destructive">
                {problems.map(problem => <li key={problem} className="break-words">{problem}</li>)}
              </ul>
            )}
            {value.invitees.length > 0 && (
              <ul aria-label={`Invited (${value.invitees.length})`} className="space-y-1">
                {value.invitees.map(pubkey => (
                  <Invitee
                    key={pubkey}
                    pubkey={pubkey}
                    onRemove={() => onChange({ invitees: value.invitees.filter(other => other !== pubkey) })}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3 rounded-md border border-dashed p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Only for the people you invite
            </p>
            <div className="flex items-start gap-2">
              <Checkbox
                id="send-invitations"
                checked={value.sendDMs}
                onCheckedChange={(checked) => onChange({ sendDMs: checked === true })}
                className="mt-0.5"
              />
              <label htmlFor="send-invitations" className="cursor-pointer text-sm leading-tight">
                Send each of them the details below in an encrypted direct message
              </label>
            </div>
            {value.sendDMs ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="exact-location">Exact location (not published)</Label>
                  <Input
                    id="exact-location"
                    value={value.exactLocation}
                    onChange={(e) => onChange({ exactLocation: e.target.value })}
                    placeholder="e.g., 12 Elm Street, side gate"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="private-details">Details for invitees (not published)</Label>
                  <Textarea
                    id="private-details"
                    value={value.privateDetails}
                    onChange={(e) => onChange({ privateDetails: e.target.value })}
                    placeholder="Door code, what to bring, who to call…"
                    rows={3}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  These two fields never go into the event. They are sent to each invitee, and cleared when this
                  form closes.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                No message will be sent. Invitees are still named on the public listing.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
