import type { NostrEvent } from '@nostrify/nostrify';
import { parseTribeId } from '@/lib/contentTags';
import { TRIBE_KIND, tribeIdOf, tribeRoleOf } from '@/lib/tribes';

/**
 * Who Village Vibe shows an event to.
 *
 * This is a display rule only. The event, its visibility value and its invitee list are
 * public on the relays, and other Nostr apps can show them to anyone.
 */
export type EventVisibility = 'public' | 'tribe-only' | 'private';

/** The answer for one viewer. `unresolved`: it depends on a member list that is not known. */
export type EventAccess = 'visible' | 'hidden' | 'unresolved';

/**
 * An event's visibility. A missing, empty or `public` value is public. Any other value
 * this app does not know is treated like `private`, the narrowest rule: the organizer
 * asked for some restriction, so the event is not shown to everyone.
 */
export function eventVisibility(event: NostrEvent): EventVisibility {
  const value = event.tags.find(([name]) => name === 'visibility')?.[1]?.trim().toLowerCase();
  if (!value || value === 'public') return 'public';
  return value === 'tribe-only' ? 'tribe-only' : 'private';
}

/**
 * The `owner:d` id of the tribe an event names with an author-qualified coordinate
 * (`["a", "34550:<owner>:<d>"]`), or null. The legacy `["tribe", "<d>"]` tag is not used:
 * any look-alike tribe can reuse a d tag, so it cannot say whose member list applies.
 */
export function eventTribeId(event: NostrEvent): string | null {
  const coordinate = event.tags.find(([name, value]) => name === 'a' && value?.startsWith(`${TRIBE_KIND}:`))?.[1];
  const tribeId = coordinate?.slice(`${TRIBE_KIND}:`.length);
  return tribeId && parseTribeId(tribeId) ? tribeId : null;
}

/**
 * Whether `viewer` (a pubkey, or undefined when logged out) is shown `event`.
 *
 * - public: everyone.
 * - tribe-only: the organizer, and current members of the tribe the event names (its
 *   owner, admins and moderators are members).
 * - private: the organizer, and the pubkeys the event invites with `p` tags. A tribe role
 *   is not an invitation.
 *
 * `tribe` is the definition of the tribe from `eventTribeId`: `null` when there is no such
 * tribe, `undefined` when it is not known (still loading, or the lookup failed). It is only
 * read for a tribe-only event someone else organized.
 */
export function eventAccess(event: NostrEvent, viewer: string | undefined, tribe: NostrEvent | null | undefined): EventAccess {
  const visibility = eventVisibility(event);
  if (visibility === 'public') return 'visible';
  if (!viewer) return 'hidden';
  if (viewer === event.pubkey) return 'visible';
  if (visibility === 'private') {
    return event.tags.some(([name, value]) => name === 'p' && value === viewer) ? 'visible' : 'hidden';
  }
  const tribeId = eventTribeId(event);
  if (!tribeId) return 'hidden';
  if (tribe === undefined) return 'unresolved';
  if (!tribe || tribe.kind !== TRIBE_KIND || tribeIdOf(tribe) !== tribeId) return 'hidden';
  return tribeRoleOf(tribe, viewer) ? 'visible' : 'hidden';
}

/** The newest definition of each tribe, by `owner:d` id. */
export function tribesById(tribes: Array<NostrEvent | null | undefined>): Map<string, NostrEvent> {
  const newest = new Map<string, NostrEvent>();
  for (const tribe of tribes) {
    if (!tribe || tribe.kind !== TRIBE_KIND) continue;
    const id = tribeIdOf(tribe);
    const current = newest.get(id);
    if (!current || tribe.created_at > current.created_at) newest.set(id, tribe);
  }
  return newest;
}

/**
 * The events of a list that `viewer` is shown. `tribes` holds the definitions that were
 * read for the list; an event whose tribe is not among them is left out unless it is
 * public, the viewer's own, or one the viewer is invited to.
 */
export function visibleEvents(events: NostrEvent[], viewer: string | undefined, tribes: ReadonlyMap<string, NostrEvent>): NostrEvent[] {
  return events.filter(event => {
    const tribeId = eventTribeId(event);
    return eventAccess(event, viewer, tribeId ? tribes.get(tribeId) : null) === 'visible';
  });
}
