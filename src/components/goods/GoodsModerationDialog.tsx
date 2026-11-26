import type { NostrEvent } from '@nostrify/nostrify';
import { ModerationDialog } from '@/components/moderation/ModerationDialog';
import { extractGoodsData, formatGoodsPrice, useHideGoodsListing } from '@/hooks/useGoods';

interface GoodsModerationDialogProps {
  children: React.ReactNode;
  listing: NostrEvent;
}

/** Hide a goods listing from the tribe feed. Goods are not promoted to villages. */
export function GoodsModerationDialog({ children, listing }: GoodsModerationDialogProps) {
  const { mutateAsync: hide, isPending } = useHideGoodsListing();
  const item = extractGoodsData(listing);

  return (
    <ModerationDialog
      noun="item"
      authorPubkey={listing.pubkey}
      isPending={isPending}
      summary={
        <>
          <h4 className="font-medium text-sm truncate">{item.title}</h4>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {item.price ? `${formatGoodsPrice(item.price)} · ` : ''}{item.description}
          </p>
        </>
      }
      onAction={async (action, reason) => {
        if (action !== 'hide') throw new Error('Items can only be hidden from the tribe.');
        await hide({ listing, reason });
      }}
    >
      {children}
    </ModerationDialog>
  );
}
