import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from './useCurrentUser';
import { useTribe } from './useTribes';
import { eventAccess, eventTribeId, eventVisibility, type EventVisibility } from '@/lib/eventVisibility';

/**
 * - `visible` / `hidden`: decided.
 * - `checking`: the event is for its tribe's members and the member list is being read.
 * - `unverified`: that member list could not be read, or no such tribe was found on the
 *   current relays. The event is neither shown nor refused; the check can be run again.
 */
export type EventAccessState = 'visible' | 'hidden' | 'checking' | 'unverified';

export interface EventAccessResult {
  state: EventAccessState;
  visibility: EventVisibility;
  /** Run the member-list lookup again (after `unverified`). */
  retry: () => void;
}

/**
 * Whether the logged-in viewer is shown `event`, for the event page (the lists use the
 * same rule through `visibleEvents`). Computed from the current viewer and the current
 * tribe definition on every render, so it follows logins, account switches and membership
 * changes without anything to invalidate.
 */
export function useEventAccess(event: NostrEvent | null | undefined): EventAccessResult {
  const { user } = useCurrentUser();
  const viewer = user?.pubkey;
  const visibility = event ? eventVisibility(event) : 'public';

  // The member list matters only for a tribe-only event someone else organized. Public
  // events, the viewer's own and invitations never wait for (or fail with) a tribe lookup.
  const needsMembers = !!event && !!viewer && visibility === 'tribe-only' && viewer !== event.pubkey;
  const tribeId = (needsMembers && eventTribeId(event)) || '';
  const tribe = useTribe(tribeId);
  const retry = () => { void tribe.refetch(); };

  if (!event) return { state: 'hidden', visibility, retry };
  if (!tribeId) return { state: eventAccess(event, viewer, null) === 'visible' ? 'visible' : 'hidden', visibility, retry };
  if (tribe.data) return { state: eventAccess(event, viewer, tribe.data) === 'visible' ? 'visible' : 'hidden', visibility, retry };
  return { state: tribe.fetchStatus === 'fetching' ? 'checking' : 'unverified', visibility, retry };
}
