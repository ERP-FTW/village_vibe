import { useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { CommentsSection } from '@/components/comments/CommentsSection';
import { extractGoodsData, formatGoodsPrice } from '@/hooks/useGoods';

interface AskAboutItemDialogProps {
  /** The goods listing (kind 30402) being asked about. */
  event: NostrEvent;
  children: React.ReactNode;
}

/**
 * Questions about one item. They are NIP-22 comments (kind 1111) whose root is the
 * listing's address, published with the same comment form used elsewhere in the app, so
 * the seller sees them wherever they manage the listing.
 */
export function AskAboutItemDialog({ event, children }: AskAboutItemDialogProps) {
  const [open, setOpen] = useState(false);
  const listing = extractGoodsData(event);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="break-words">{listing.title}</DialogTitle>
          <DialogDescription>
            {listing.price ? `${formatGoodsPrice(listing.price)} · ` : ''}
            Questions and answers are public on Nostr.
          </DialogDescription>
        </DialogHeader>
        {/* Loaded only while open: one comment query per opened item, not per card. */}
        {open && (
          <CommentsSection
            root={event}
            title="Questions"
            placeholder="Ask about pickup, condition or availability…"
            emptyStateMessage="No questions yet"
            emptyStateSubtitle="Ask the seller about this item."
            className="border-0 shadow-none"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
