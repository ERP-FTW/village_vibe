import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { PublicFieldsNotice } from '@/components/privacy/PublicFieldsNotice';
import { TRIBE_PUBLIC_FIELDS } from '@/lib/publicFields';

interface TribeAccessSettingsProps {
  listed: boolean;
  open: boolean;
  onListedChange: (listed: boolean) => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * Discovery and membership settings for a tribe, worded for what they do: "unlisted" keeps the
 * tribe out of Village Vibe's lists but its definition stays public on Nostr, and "open" is a
 * label, since every join is a request an admin approves.
 */
export function TribeAccessSettings({ listed, open, onListedChange, onOpenChange }: TribeAccessSettingsProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="tribe-listed">Listed in discovery</Label>
          <p id="tribe-listed-hint" className="text-xs text-muted-foreground">
            {listed
              ? 'Shown in Village Vibe’s tribe lists and on members’ profiles.'
              : 'Unlisted: left out of Village Vibe’s tribe lists. Anyone with the link, or using another Nostr app, can still read it.'}
          </p>
        </div>
        <Switch id="tribe-listed" checked={listed} onCheckedChange={onListedChange} aria-describedby="tribe-listed-hint" />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="tribe-open">Open to new members</Label>
          <p id="tribe-open-hint" className="text-xs text-muted-foreground">
            Shown on the tribe as open or closed. Joining always sends a request that an admin approves.
          </p>
        </div>
        <Switch id="tribe-open" checked={open} onCheckedChange={onOpenChange} aria-describedby="tribe-open-hint" />
      </div>

      <PublicFieldsNotice
        subject="this tribe"
        fields={TRIBE_PUBLIC_FIELDS}
        note="Unlisting a tribe does not hide any of this."
      />
    </div>
  );
}
