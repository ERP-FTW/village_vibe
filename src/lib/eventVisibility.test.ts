import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { eventAccess, eventTribeId, eventVisibility, tribesById, visibleEvents } from './eventVisibility';

const key = (char: string) => char.repeat(64);
const OWNER = key('a');
const HOST = key('b');
const MEMBER = key('c');
const MODERATOR = key('d');
const INVITEE = key('e');
const STRANGER = key('f');
const IMPOSTOR = key('9');

const tribeOf = (owner: string, members: string[][], created_at = 100): NostrEvent => ({
  id: key('1'), pubkey: owner, kind: 34550, created_at, content: '', sig: '', tags: [['d', 'garden'], ...members],
});
const tribe = tribeOf(OWNER, [['p', HOST, '', 'event_creator'], ['p', MEMBER, '', 'member'], ['p', MODERATOR, '', 'moderator']]);
// Someone else's tribe that reuses the d tag and lists the stranger as a member.
const lookAlike = tribeOf(IMPOSTOR, [['p', STRANGER, '', 'admin']]);

const meetup = (tags: string[][], kind = 36959): NostrEvent => ({
  id: key('2'), pubkey: HOST, kind, created_at: 200, content: '', sig: '',
  tags: [['d', 'dinner'], ['title', 'Dinner'], ['start', '1900000000'], ...tags],
});
const coordinate = ['a', `34550:${OWNER}:garden`];
const everyone = [undefined, HOST, MEMBER, MODERATOR, OWNER, INVITEE, STRANGER];
const admitted = (event: NostrEvent, known: NostrEvent | null | undefined = tribe) =>
  everyone.filter(viewer => eventAccess(event, viewer, known) === 'visible');

describe('eventVisibility', () => {
  it('reads a missing, empty or public value as public', () => {
    expect(eventVisibility(meetup([]))).toBe('public');
    expect(eventVisibility(meetup([['visibility', '']]))).toBe('public');
    expect(eventVisibility(meetup([['visibility', 'public']]))).toBe('public');
  });

  it('reads the two restricted values, and narrows a value it does not know', () => {
    expect(eventVisibility(meetup([['visibility', 'tribe-only']]))).toBe('tribe-only');
    expect(eventVisibility(meetup([['visibility', 'private']]))).toBe('private');
    expect(eventVisibility(meetup([['visibility', ' Tribe-Only ']], 31923))).toBe('tribe-only');
    expect(eventVisibility(meetup([['visibility', 'friends']], 31923))).toBe('private');
  });
});

describe('eventTribeId', () => {
  it('takes the tribe from an author-qualified coordinate only', () => {
    expect(eventTribeId(meetup([coordinate, ['tribe', 'garden']]))).toBe(`${OWNER}:garden`);
    expect(eventTribeId(meetup([['tribe', 'garden']]))).toBeNull();
    expect(eventTribeId(meetup([['a', '34550:not-a-key:garden']]))).toBeNull();
    expect(eventTribeId(meetup([['a', `30023:${OWNER}:garden`]]))).toBeNull();
    expect(eventTribeId(meetup([['a', `34550:${OWNER}:garden:plot:7`]]))).toBe(`${OWNER}:garden:plot:7`);
  });
});

describe('eventAccess', () => {
  it('shows a public event to everyone, whatever is known about the tribe', () => {
    for (const known of [tribe, null, undefined]) {
      expect(admitted(meetup([coordinate]), known)).toEqual(everyone);
      expect(admitted(meetup([coordinate, ['visibility', 'public']]), known)).toEqual(everyone);
    }
  });

  it('shows a tribe-only event to the organizer and current members, leadership included', () => {
    expect(admitted(meetup([coordinate, ['visibility', 'tribe-only']]))).toEqual([HOST, MEMBER, MODERATOR, OWNER]);
  });

  it('keeps showing a tribe-only event to an organizer who is no longer a member', () => {
    const without = tribeOf(OWNER, [['p', MEMBER, '', 'member']]);
    expect(admitted(meetup([coordinate, ['visibility', 'tribe-only']]), without)).toEqual([HOST, MEMBER, OWNER]);
  });

  it('shows an invited-only event to the organizer and the invitees, not to tribe leadership', () => {
    const event = meetup([coordinate, ['visibility', 'private'], ['p', INVITEE]]);
    expect(admitted(event)).toEqual([HOST, INVITEE]);
    // No member list is needed for it
    expect(admitted(event, undefined)).toEqual([HOST, INVITEE]);
    expect(admitted(event, null)).toEqual([HOST, INVITEE]);
  });

  it('does not decide a tribe-only event while the member list is unknown', () => {
    const event = meetup([coordinate, ['visibility', 'tribe-only']]);
    expect(eventAccess(event, MEMBER, undefined)).toBe('unresolved');
    expect(eventAccess(event, STRANGER, undefined)).toBe('unresolved');
    // These never depend on it
    expect(eventAccess(event, HOST, undefined)).toBe('visible');
    expect(eventAccess(event, undefined, undefined)).toBe('hidden');
  });

  it('hides a tribe-only event when its tribe does not exist', () => {
    expect(admitted(meetup([coordinate, ['visibility', 'tribe-only']]), null)).toEqual([HOST]);
  });

  it('takes no authority from a legacy tribe slug', () => {
    // Only the slug: no tribe can be named, so only the organizer sees it.
    const legacy = meetup([['tribe', 'garden'], ['visibility', 'tribe-only']]);
    expect(admitted(legacy, tribe)).toEqual([HOST]);
    expect(admitted(legacy, lookAlike)).toEqual([HOST]);
    expect(eventAccess(legacy, MEMBER, undefined)).toBe('hidden');
  });

  it('ignores the member list of a different tribe with the same slug', () => {
    const event = meetup([coordinate, ['tribe', 'garden'], ['visibility', 'tribe-only']]);
    expect(eventAccess(event, STRANGER, lookAlike)).toBe('hidden');
    expect(eventAccess(event, MEMBER, lookAlike)).toBe('hidden');
  });
});

describe('visibleEvents', () => {
  const open = meetup([coordinate]);
  const members = meetup([coordinate, ['visibility', 'tribe-only']]);
  const invited = meetup([coordinate, ['visibility', 'private'], ['p', INVITEE]]);

  it('keeps what the viewer is shown, in order', () => {
    const tribes = tribesById([tribe, lookAlike]);
    expect(visibleEvents([open, members, invited], undefined, tribes)).toEqual([open]);
    expect(visibleEvents([open, members, invited], STRANGER, tribes)).toEqual([open]);
    expect(visibleEvents([open, members, invited], MEMBER, tribes)).toEqual([open, members]);
    expect(visibleEvents([open, members, invited], INVITEE, tribes)).toEqual([open, invited]);
    expect(visibleEvents([open, members, invited], HOST, tribes)).toEqual([open, members, invited]);
  });

  it('leaves out a tribe-only event whose member list was not read', () => {
    expect(visibleEvents([open, members, invited], MEMBER, new Map())).toEqual([open]);
    expect(visibleEvents([open, members, invited], HOST, new Map())).toEqual([open, members, invited]);
  });

  it('uses the newest definition of a tribe', () => {
    const removed = tribeOf(OWNER, [], 300);
    expect(visibleEvents([members], MEMBER, tribesById([tribe, removed, null, undefined]))).toEqual([]);
    expect(visibleEvents([members], MEMBER, tribesById([removed, tribe]))).toEqual([]);
  });
});
