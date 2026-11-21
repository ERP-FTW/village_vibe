import { useSeoMeta } from '@unhead/react';
import { useParams } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { ProfileView } from '@/components/profile/ProfileView';
import NotFound from './NotFound';

/** Accept a hex pubkey, npub or nprofile in /profile/:pubkey. */
function toHexPubkey(value: string | undefined): string | null {
  if (!value) return null;
  if (/^[0-9a-f]{64}$/.test(value)) return value;
  try {
    const decoded = nip19.decode(value);
    if (decoded.type === 'npub') return decoded.data;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
  } catch {
    // fall through
  }
  return null;
}

const ProfilePage = () => {
  const { pubkey: param } = useParams<{ pubkey: string }>();
  const pubkey = toHexPubkey(param);

  useSeoMeta({
    title: 'Profile - Village Vibe',
    description: 'View user profile, badges, and tribe memberships.',
  });

  if (!pubkey) {
    return <NotFound />;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <ProfileView pubkey={pubkey} />
    </div>
  );
};

export default ProfilePage;
