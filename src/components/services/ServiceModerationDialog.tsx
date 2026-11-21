import { useCreateServiceLabel, usePromoteServiceToVillages } from '@/hooks/useServices';
import { ModerationDialog } from '@/components/moderation/ModerationDialog';
import { MODERATION_LABELS } from '@/lib/moderationLabels';
import type { NostrEvent } from '@nostrify/nostrify';

interface ServiceModerationDialogProps {
  children: React.ReactNode;
  service: NostrEvent;
  villageSlug?: string;
  onPromote?: () => void;
}

export function ServiceModerationDialog({ children, service, villageSlug, onPromote }: ServiceModerationDialogProps) {
  const { mutateAsync: createLabel, isPending: isCreatingLabel } = useCreateServiceLabel();
  const { mutateAsync: promoteToVillages, isPending: isPromoting } = usePromoteServiceToVillages();

  const serviceId = `${service.pubkey}:${service.tags.find(([name]) => name === 'd')?.[1]}`;
  const serviceType = service.kind === 38857 ? 'offer' : 'request';
  const serviceCategory = service.tags.find(([name]) => name === 't')?.[1] || 'service';

  return (
    <ModerationDialog
      noun="service"
      authorPubkey={service.pubkey}
      villageSlug={villageSlug}
      isPending={isCreatingLabel || isPromoting}
      onPromote={onPromote}
      summary={
        <>
          <h4 className="font-medium text-sm capitalize">{serviceType} - {serviceCategory}</h4>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{service.content}</p>
        </>
      }
      onAction={async (action, reason) => {
        if (action === 'promote' && villageSlug) {
          await promoteToVillages({ service, villages: [villageSlug], reason });
          return;
        }
        if (service.kind !== 38857 && service.kind !== 30627) throw new Error('Unsupported service kind');
        await createLabel({
          serviceId,
          serviceKind: service.kind,
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
