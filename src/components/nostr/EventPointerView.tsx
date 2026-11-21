import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Link } from 'react-router-dom';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { addressRoute } from '@/lib/nostrRoutes';
import { NoteContent } from '@/components/NoteContent';
import { RelaySelector } from '@/components/RelaySelector';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { NostrEvent } from '@nostrify/nostrify';

function NoteCard({ event }: { event: NostrEvent }) {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const name = metadata?.name ?? genUserName(event.pubkey);
  return (
    <Card>
      <CardHeader className="pb-2">
        <Link to={`/profile/${event.pubkey}`} className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={metadata?.picture} alt={name} />
            <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(event.created_at * 1000).toLocaleString()}
            </p>
          </div>
        </Link>
      </CardHeader>
      <CardContent>
        <div className="whitespace-pre-wrap break-words">
          <NoteContent event={event} className="text-sm" />
        </div>
      </CardContent>
    </Card>
  );
}

/** Shows a `note1` / `nevent1` target: text notes inline, app content via its own page. */
export function EventPointerView({ id, relays }: { id: string; relays?: string[] }) {
  const { nostr } = useNostr();
  const { data: event, isLoading, error } = useQuery({
    queryKey: ['event-by-id', id],
    queryFn: async ({ signal }) => {
      const [found] = await nostr.query([{ ids: [id], limit: 1 }], { signal, relays: relays?.length ? relays : undefined });
      return found ?? null;
    },
  });

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardContent className="space-y-3 p-6">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (event) {
    const d = event.tags.find(([name]) => name === 'd')?.[1];
    const route = d !== undefined ? addressRoute(event.kind, event.pubkey, d) : null;
    if (route) return <Navigate to={route} replace />;
    if (event.kind === 1) {
      return (
        <div className="container mx-auto max-w-2xl px-4 py-8">
          <NoteCard event={event} />
        </div>
      );
    }
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <Card className="border-dashed">
        <CardContent className="space-y-6 px-8 py-12 text-center">
          <p className="text-muted-foreground">
            {error
              ? 'The relays could not be reached. Try another relay?'
              : event
                ? `This kind of Nostr event (kind ${event.kind}) can't be shown here.`
                : 'This event was not found. Try another relay?'}
          </p>
          <RelaySelector className="w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
