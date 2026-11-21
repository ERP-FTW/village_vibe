import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Link } from 'react-router-dom';
import { NoteContent } from '@/components/NoteContent';
import { RelaySelector } from '@/components/RelaySelector';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { genUserName } from '@/lib/genUserName';
import { useAuthor } from '@/hooks/useAuthor';
import type { NostrEvent } from '@nostrify/nostrify';

function HashtagNote({ event }: { event: NostrEvent }) {
  const author = useAuthor(event.pubkey);
  const name = author.data?.metadata?.name ?? genUserName(event.pubkey);
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <Link to={`/profile/${event.pubkey}`} className="text-sm font-medium hover:underline">{name}</Link>
        <div className="whitespace-pre-wrap break-words">
          <NoteContent event={event} className="text-sm" />
        </div>
      </CardContent>
    </Card>
  );
}

/** Recent text notes for a hashtag (linked from note content). */
export default function HashtagPage() {
  const { tag = '' } = useParams<{ tag: string }>();
  const hashtag = tag.toLowerCase();
  const { nostr } = useNostr();

  useSeoMeta({ title: `#${hashtag} - Village Vibe` });

  const { data: notes, isLoading, error } = useQuery({
    queryKey: ['hashtag', hashtag],
    queryFn: ({ signal }) => nostr.query([{ kinds: [1], '#t': [hashtag], limit: 30 }], { signal }),
    enabled: !!hashtag,
  });

  return (
    <div className="container mx-auto max-w-2xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-bold">#{hashtag}</h1>
      {isLoading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-2 p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </CardContent>
          </Card>
        ))
      ) : notes?.length ? (
        notes.map(note => <HashtagNote key={note.id} event={note} />)
      ) : (
        <Card className="border-dashed">
          <CardContent className="space-y-6 px-8 py-12 text-center">
            <p className="text-muted-foreground">
              {error ? 'The relays could not be reached.' : 'No posts found.'} Try another relay?
            </p>
            <RelaySelector className="w-full" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
