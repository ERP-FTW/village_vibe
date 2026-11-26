import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AskAboutItemDialog } from './AskAboutItemDialog';
import { GoodsModerationDialog } from './GoodsModerationDialog';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { extractGoodsData, formatGoodsPrice, useSetGoodsStatus } from '@/hooks/useGoods';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';
import { ExternalLink, Loader2, MapPin, MessageCircleQuestion, Shield } from 'lucide-react';

interface GoodsCardProps {
  event: NostrEvent;
  className?: string;
  /** Tribe moderators can hide a listing from the tribe feed. */
  showModerationControls?: boolean;
}

export function GoodsCard({ event, className, showModerationControls = false }: GoodsCardProps) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const author = useAuthor(event.pubkey);
  const { mutate: setStatus, isPending: isUpdating } = useSetGoodsStatus();
  // A picture that no longer loads is left out rather than shown as a broken image.
  const [imageFailed, setImageFailed] = useState(false);

  const listing = extractGoodsData(event);
  const description = listing.description || listing.summary;
  // The card shows four lines. When the text is longer than that, it can be opened in place.
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  useEffect(() => {
    const element = descriptionRef.current;
    if (!element || expanded) return;
    const measure = () => setClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [description, expanded]);

  const metadata = author.data?.metadata;
  const sellerName = metadata?.name ?? genUserName(event.pubkey);
  const isSeller = user?.pubkey === event.pubkey;
  const isSold = listing.status === 'sold';

  const toggleSold = () => {
    setStatus({ listing: event, status: isSold ? 'active' : 'sold' }, {
      onSuccess: () => toast({ title: isSold ? 'Marked as available' : 'Marked as sold' }),
      onError: (error) => toast({
        title: 'Could not update the listing',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      }),
    });
  };

  return (
    <Card className={cn('flex flex-col overflow-hidden', isSold && 'opacity-75', className)}>
      {listing.image && !imageFailed && (
        <div className="aspect-[4/3] w-full overflow-hidden bg-muted">
          <img
            src={listing.image}
            alt={listing.title}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        </div>
      )}

      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold leading-snug break-words">{listing.title}</h3>
          {isSold && <Badge variant="secondary" className="shrink-0">Sold</Badge>}
        </div>
        <p className="text-lg font-bold">
          {listing.price ? formatGoodsPrice(listing.price) : <span className="text-sm font-normal text-muted-foreground">Ask for the price</span>}
        </p>
      </CardHeader>

      <CardContent className="flex-1 space-y-3 pb-3">
        {description && (
          <div>
            <p
              ref={descriptionRef}
              className={cn('text-sm leading-relaxed whitespace-pre-wrap break-words', !expanded && 'line-clamp-4')}
            >
              {description}
            </p>
            {(clamped || expanded) && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                aria-expanded={expanded}
                onClick={() => setExpanded(open => !open)}
              >
                {expanded ? 'Show less' : 'Show more'}
              </Button>
            )}
          </div>
        )}
        {listing.location && (
          <div className="flex items-center text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 mr-1.5 shrink-0" />
            <span className="truncate">{listing.location}</span>
          </div>
        )}
        <Link
          to={`/${nip19.npubEncode(event.pubkey)}`}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Avatar className="h-6 w-6">
            <AvatarImage src={metadata?.picture} alt={sellerName} />
            <AvatarFallback className="text-[10px]">{sellerName.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="truncate">{sellerName}</span>
        </Link>
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2 pt-0">
        <AskAboutItemDialog event={event}>
          <Button size="sm" variant={isSeller ? 'outline' : 'default'}>
            <MessageCircleQuestion className="h-4 w-4 mr-1.5" />
            {isSeller ? 'Questions' : 'Ask about this item'}
          </Button>
        </AskAboutItemDialog>

        {listing.link && (
          <Button size="sm" variant="outline" asChild>
            <a href={listing.link} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-1.5" />
              Product page
            </a>
          </Button>
        )}

        {isSeller && (
          <Button size="sm" variant="outline" onClick={toggleSold} disabled={isUpdating}>
            {isUpdating && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {isSold ? 'Mark available' : 'Mark sold'}
          </Button>
        )}

        {showModerationControls && !isSeller && (
          <GoodsModerationDialog listing={event}>
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" aria-label="Moderate this item">
              <Shield className="h-4 w-4" />
            </Button>
          </GoodsModerationDialog>
        )}
      </CardFooter>
    </Card>
  );
}
