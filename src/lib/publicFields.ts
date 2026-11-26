/**
 * What Village Vibe publishes in the clear. Tribes, events and their settings are ordinary
 * Nostr events: anyone reading a relay (or using another Nostr client) can see every tag and
 * the content. Settings such as "unlisted" or an event's visibility only change what this app
 * shows; they are not access control or encryption. Only direct messages are encrypted.
 *
 * Each list maps the tags an app-created record carries to the plain-language field shown to
 * the author before publishing, so the notice and the signed event cannot drift apart.
 */

export interface PublicField {
  label: string;
  /** Tag names (first element) this field is published as. */
  tags: string[];
  /** Published in the event's content field. */
  content?: boolean;
}

/** Fields of every Nostr event, regardless of kind. */
const AUTHOR_FIELD: PublicField = {
  label: 'Your Nostr public key, the time you published, and the app name',
  tags: ['client'],
};

export const TRIBE_PUBLIC_FIELDS: PublicField[] = [
  { label: 'Tribe name', tags: ['name'] },
  { label: 'Description', tags: ['description'], content: true },
  { label: 'Location', tags: ['location'] },
  { label: 'Image', tags: ['image'] },
  { label: 'Member list and each member’s role', tags: ['p'] },
  { label: 'Listed or unlisted, and open or closed', tags: ['public', 'private', 'open', 'closed'] },
  { label: 'Associated villages', tags: ['village', 't'] },
  { label: 'Tribe identifier (part of its link)', tags: ['d'] },
  AUTHOR_FIELD,
];

export const EVENT_PUBLIC_FIELDS: PublicField[] = [
  { label: 'Title, summary and description', tags: ['title', 'summary'], content: true },
  { label: 'Date, time and duration', tags: ['start', 'end'] },
  { label: 'Location, and the approximate area if you share one', tags: ['place', 'g'] },
  { label: 'Image', tags: ['image'] },
  {
    label: 'Event types and their details (food slots, tasks, gear, games…)',
    tags: ['etype', 'food', 'diet_notes', 'task', 'tools_needed', 'instructors', 'materials', 'game_kind', 'teams_mode', 'occasion'],
  },
  { label: 'Tribe and villages', tags: ['a', 'tribe', 'village', 't'] },
  { label: 'Visibility setting', tags: ['visibility'] },
  { label: 'Invitee list (invite-only events)', tags: ['p'] },
  { label: 'Event identifier and a short description for other apps', tags: ['d', 'alt'] },
  AUTHOR_FIELD,
];

export const GOODS_PUBLIC_FIELDS: PublicField[] = [
  { label: 'Title and description', tags: ['title'], content: true },
  { label: 'Price and currency', tags: ['price'] },
  { label: 'Whether the item is available or sold', tags: ['status'] },
  { label: 'Area, if you give one (use a general area, not your address)', tags: ['location'] },
  { label: 'Picture and product page link, if you add them', tags: ['image', 'r'] },
  { label: 'Tribe', tags: ['a', 'tribe'] },
  { label: 'Listing identifier and the date it was first posted', tags: ['d', 'published_at'] },
  AUTHOR_FIELD,
];

/** Tag names on an event that no public field describes (should be empty). */
export function undisclosedTags(tags: string[][], fields: PublicField[]): string[] {
  const disclosed = new Set(fields.flatMap(field => field.tags));
  return [...new Set(tags.map(([name]) => name).filter(name => !disclosed.has(name)))];
}
