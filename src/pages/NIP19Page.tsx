import { nip19 } from 'nostr-tools';
import { useParams, Navigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { ProfileView } from '@/components/profile/ProfileView';
import { EventPointerView } from '@/components/nostr/EventPointerView';
import { addressRoute } from '@/lib/nostrRoutes';
import NotFound from './NotFound';

function decode(identifier: string | undefined) {
  if (!identifier) return null;
  try {
    return nip19.decode(identifier);
  } catch {
    return null;
  }
}

export function NIP19Page() {
  const { nip19: identifier } = useParams<{ nip19: string }>();
  const decoded = decode(identifier);

  useSeoMeta({ title: 'Village Vibe' });

  if (!decoded) {
    return <NotFound />;
  }

  switch (decoded.type) {
    case 'npub':
    case 'nprofile': {
      const pubkey = decoded.type === 'npub' ? decoded.data : decoded.data.pubkey;
      return (
        <div className="container mx-auto px-4 py-8">
          <ProfileView pubkey={pubkey} />
        </div>
      );
    }

    case 'note':
      return <EventPointerView id={decoded.data} />;

    case 'nevent':
      return <EventPointerView id={decoded.data.id} relays={decoded.data.relays} />;

    case 'naddr': {
      const { kind, pubkey, identifier: d } = decoded.data;
      const route = addressRoute(kind, pubkey, d);
      return route ? <Navigate to={route} replace /> : <NotFound />;
    }

    default:
      return <NotFound />;
  }
}
