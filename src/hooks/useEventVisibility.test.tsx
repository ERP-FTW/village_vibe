import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { TestApp } from '@/test/TestApp';

/**
 * Who is shown which event. Visibility is an app display rule (the listing itself is public
 * on relays), so the same answer has to come from the tribe list, the village list, the
 * event page and NIP-19 links, for whoever is logged in right now.
 */

const key = (char: string) => char.repeat(64);
const OWNER = key('a');     // tribe creator (admin)
const HOST = key('b');      // organizer, an event creator in the tribe
const MEMBER = key('c');
const MODERATOR = key('d');
const INVITEE = key('e');   // invited, not a tribe member
const STRANGER = key('f');

const TRIBE_ID = `${OWNER}:garden`;
const COORDINATE = `34550:${TRIBE_ID}`;
const tribe: NostrEvent = {
  id: key('1'), pubkey: OWNER, kind: 34550, created_at: 1_800_000_000, content: '', sig: '',
  tags: [['d', 'garden'], ['name', 'Garden'], ['p', HOST, '', 'event_creator'], ['p', MEMBER, '', 'member'], ['p', MODERATOR, '', 'moderator']],
};

let serial = 0;
function meetup(title: string, author: string, extra: string[][], link: string[][] = [['a', COORDINATE], ['tribe', 'garden']]): NostrEvent {
  serial += 1;
  return {
    id: serial.toString(16).padStart(64, '0'), pubkey: author, kind: 36959, created_at: 1_800_000_000 + serial, content: `About ${title}`, sig: '',
    tags: [['d', title.toLowerCase().replace(/\W+/g, '-')], ...link, ['title', title], ['start', '1900000000'], ['place', 'The shed'], ...extra],
  };
}
const OPEN = meetup('Open potluck', HOST, []);
const OPEN_BY_OWNER = meetup('Owner picnic', OWNER, [['visibility', 'public']]);
const MEMBERS_ONLY = meetup('Members planning', HOST, [['visibility', 'tribe-only']]);
const OWNER_MEMBERS_ONLY = meetup('Owner members night', OWNER, [['visibility', 'tribe-only']]);
const INVITED = meetup('Invited dinner', HOST, [['visibility', 'private'], ['p', INVITEE]]);
// Names its tribe only by the legacy slug, which any look-alike tribe can reuse.
const LEGACY_MEMBERS_ONLY = meetup('Legacy members night', HOST, [['visibility', 'tribe-only']], [['tribe', 'garden']]);
const ALL = [OPEN, OPEN_BY_OWNER, MEMBERS_ONLY, OWNER_MEMBERS_ONLY, INVITED, LEGACY_MEMBERS_ONLY];
const RESTRICTED_TITLES = ['Members planning', 'Owner members night', 'Invited dinner', 'Legacy members night'];
const title = (event: NostrEvent) => event.tags.find(([name]) => name === 'title')?.[1] ?? '';

/** What each viewer may be shown, everywhere. */
const EXPECTED: Array<[string, string | undefined, string[]]> = [
  ['a logged-out visitor', undefined, ['Open potluck', 'Owner picnic']],
  ['the organizer', HOST, ['Open potluck', 'Owner picnic', 'Members planning', 'Owner members night', 'Invited dinner', 'Legacy members night']],
  ['a tribe member', MEMBER, ['Open potluck', 'Owner picnic', 'Members planning', 'Owner members night']],
  ['a moderator who was not invited', MODERATOR, ['Open potluck', 'Owner picnic', 'Members planning', 'Owner members night']],
  ['the tribe owner', OWNER, ['Open potluck', 'Owner picnic', 'Members planning', 'Owner members night']],
  ['an invited non-member', INVITEE, ['Open potluck', 'Owner picnic', 'Invited dinner']],
  ['an unrelated user', STRANGER, ['Open potluck', 'Owner picnic']],
];

// --- a relay small enough to read: events matched by kind, author, d, a and id ---------
let viewer: string | undefined;
let tribeLookup: 'ok' | 'fails' | Promise<void> = 'ok';
/** The tribe definition the relay holds; publishing a new one replaces it. */
let relayTribe = tribe;
let signed = 0;

function matches(event: NostrEvent, filter: NostrFilter): boolean {
  const tagged = (name: string) => event.tags.filter(tag => tag[0] === name).map(tag => tag[1]);
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter['#d'] && !filter['#d'].some(value => tagged('d').includes(value))) return false;
  if (filter['#a'] && !filter['#a'].some(value => tagged('a').includes(value))) return false;
  if (filter['#e'] || filter['#A'] || filter['#E'] || filter['#p'] || filter['#l'] || filter['#h']) return false;
  return true;
}
async function query(filters: NostrFilter[]): Promise<NostrEvent[]> {
  if (filters.some(filter => filter.kinds?.includes(34550))) {
    if (tribeLookup === 'fails') throw new Error('relays down');
    if (tribeLookup !== 'ok') await tribeLookup;
  }
  return [relayTribe, ...ALL].filter(event => filters.some(filter => matches(event, filter)));
}
async function publish(event: NostrEvent): Promise<void> {
  if (event.kind === 34550) relayTribe = event;
}

vi.mock('@nostrify/react', async (importOriginal) => ({
  ...await importOriginal<typeof import('@nostrify/react')>(),
  useNostr: () => ({ nostr: { query, event: publish } }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: viewer ? {
      pubkey: viewer,
      // Enough of a signer to publish a tribe definition in these tests
      signer: { signEvent: async (template: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({ ...template, id: `${++signed}`.padStart(64, '7'), pubkey: viewer!, sig: '' }) },
    } : undefined,
  }),
}));
vi.mock('@/hooks/useAuthor', () => ({ useAuthor: () => ({ data: undefined }) }));
// The village reader has its own tests; here it returns these events and their tribe.
vi.mock('@/lib/villageFeed', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/villageFeed')>(),
  readVillageFeed: async () => {
    const tribes = await query([{ kinds: [34550], authors: [OWNER], '#d': ['garden'] }]);
    return { events: ALL, tribes, featured: new Set<string>(), promotionsComplete: true, promotionsCanReadFurther: false };
  },
}));

const { useTribeEvents, useVillageEvents } = await import('./useEvents');
const { useNostrPublish } = await import('./useNostrPublish');
const { EventView } = await import('@/components/events/EventView');
const { NIP19Page } = await import('@/pages/NIP19Page');
const { default: EventPage } = await import('@/pages/EventPage');

const eventId = (event: NostrEvent) => `${event.pubkey}:${event.tags.find(([name]) => name === 'd')?.[1]}`;
const shownTitles = () => ALL.map(title).filter(text => document.body.textContent?.includes(text));

/** Records every restricted title that reaches the page, however briefly. */
function watchForRestricted(): { seen: Set<string>; stop: () => void } {
  const seen = new Set<string>();
  const look = () => RESTRICTED_TITLES.forEach(text => { if (document.body.textContent?.includes(text)) seen.add(text); });
  const observer = new MutationObserver(look);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return { seen, stop: () => { look(); observer.disconnect(); } };
}

/**
 * The app with one query cache that lasts for the whole test, as it does in the browser:
 * what one account loaded is still cached when the next account is looking.
 */
function appWithCache() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <TestApp><QueryClientProvider client={client}>{children}</QueryClientProvider></TestApp>
  );
  return { client, wrapper };
}

beforeEach(() => { viewer = undefined; tribeLookup = 'ok'; relayTribe = tribe; window.history.pushState({}, '', '/'); });
afterEach(cleanup);

describe('event visibility is the same wherever an event can be reached', () => {
  describe.each(EXPECTED)('%s', (_who, pubkey, allowed) => {
    beforeEach(() => { viewer = pubkey; });

    it('sees only their events in the tribe list', async () => {
      const { result } = renderHook(() => useTribeEvents(TRIBE_ID), { wrapper: TestApp });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.map(title).sort()).toEqual([...allowed].sort());
    });

    it('sees the same events in the village list', async () => {
      const { result } = renderHook(() => useVillageEvents('east-side'), { wrapper: TestApp });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.map(title).sort()).toEqual([...allowed].sort());
    });

    it('gets the same answer from each event page', async () => {
      for (const event of ALL) {
        const watch = watchForRestricted();
        const view = render(<TestApp><EventView eventId={eventId(event)} /></TestApp>);
        if (allowed.includes(title(event))) {
          await waitFor(() => expect(screen.getByRole('heading', { name: title(event) })).toBeInTheDocument());
        } else {
          await waitFor(() => expect(screen.getByText(/is shown only to/i)).toBeInTheDocument());
          watch.stop();
          expect([...watch.seen]).toEqual([]);
          // Nothing about the event is rendered: not its text, place or tabs.
          expect(document.body.textContent).not.toContain(event.content);
          expect(screen.queryByRole('tab', { name: /RSVP/ })).not.toBeInTheDocument();
        }
        watch.stop();
        view.unmount();
      }
    });
  });

  it('search within a list never brings back an event the viewer may not see', async () => {
    viewer = STRANGER;
    const { result } = renderHook(() => useTribeEvents(TRIBE_ID, { search: 'night' }), { wrapper: TestApp });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    viewer = MEMBER;
    const member = renderHook(() => useTribeEvents(TRIBE_ID, { search: 'night' }), { wrapper: TestApp });
    await waitFor(() => expect(member.result.current.data?.map(title)).toEqual(['Owner members night']));
  });
});

describe('NIP-19 links follow the same rule', () => {
  const routes = (
    <TestApp>
      <Routes>
        <Route path="/event/:eventId" element={<EventPage />} />
        <Route path="/:nip19" element={<NIP19Page />} />
      </Routes>
    </TestApp>
  );
  const links = (event: NostrEvent) => [
    ['naddr', nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: event.tags.find(([name]) => name === 'd')![1] })],
    ['nevent', nip19.neventEncode({ id: event.id })],
    ['note', nip19.noteEncode(event.id)],
  ];

  it.each([...links(INVITED), ...links(MEMBERS_ONLY)])('%s of a restricted event shows nothing to an unrelated user', async (_kind, link) => {
    viewer = STRANGER;
    window.history.pushState({}, '', `/${link}`);
    const watch = watchForRestricted();
    render(routes);
    await waitFor(() => expect(screen.getByText(/is shown only to/i)).toBeInTheDocument());
    watch.stop();
    expect([...watch.seen]).toEqual([]);
  });

  it.each(links(INVITED))('%s opens the event for someone who was invited', async (_kind, link) => {
    viewer = INVITEE;
    window.history.pushState({}, '', `/${link}`);
    render(routes);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Invited dinner' })).toBeInTheDocument());
  });

  it.each(links(OPEN))('%s of a public event opens for a logged-out visitor', async (_kind, link) => {
    window.history.pushState({}, '', `/${link}`);
    render(routes);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Open potluck' })).toBeInTheDocument());
  });
});

describe('switching accounts', () => {
  it('updates both lists, and the next viewer never receives the previous viewer\'s events', async () => {
    const { wrapper } = appWithCache();
    viewer = HOST;
    const received: Array<{ viewer: string | undefined; titles: string[] }> = [];
    const { result, rerender } = renderHook(() => {
      const lists = { tribe: useTribeEvents(TRIBE_ID), village: useVillageEvents('east-side') };
      received.push({ viewer, titles: [...(lists.tribe.data ?? []), ...(lists.village.data ?? [])].map(title) });
      return lists;
    }, { wrapper });
    const bothShow = (count: number) => waitFor(() => {
      expect(result.current.tribe.data).toHaveLength(count);
      expect(result.current.village.data).toHaveLength(count);
    });
    await bothShow(6);

    // Back and forth, so each account also returns to what was cached for it earlier.
    for (const [next, allowed] of [[STRANGER, 2], [MEMBER, 4], [undefined, 2], [INVITEE, 3], [HOST, 6], [STRANGER, 2]] as const) {
      viewer = next;
      rerender();
      await bothShow(allowed);
    }
    for (const snapshot of received) {
      const allowed = EXPECTED.find(([, pubkey]) => pubkey === snapshot.viewer)![2];
      expect(snapshot.titles.filter(text => !allowed.includes(text))).toEqual([]);
    }
  });

  it('updates an open event page without showing the event in between', async () => {
    const { wrapper } = appWithCache();
    viewer = INVITEE;
    // A new element each time: React skips re-rendering an identical one.
    const page = () => <EventView eventId={eventId(INVITED)} />;
    const view = render(page(), { wrapper });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Invited dinner' })).toBeInTheDocument());

    viewer = STRANGER;
    const watch = watchForRestricted();
    view.rerender(page());
    await waitFor(() => expect(screen.getByText(/is shown only to/i)).toBeInTheDocument());
    watch.stop();
    expect([...watch.seen]).toEqual([]);
    expect(shownTitles()).toEqual([]);

    viewer = HOST;
    view.rerender(page());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Invited dinner' })).toBeInTheDocument());
  });
});

describe('a membership change made in this app', () => {
  const MEMBERS_EVENTS = ['Members planning', 'Owner members night'];

  it('takes effect in the tribe list, the village list and an open event page at once', async () => {
    const { wrapper } = appWithCache();
    viewer = MEMBER;
    const received: string[] = [];
    const { result, rerender } = renderHook(() => {
      const app = { tribe: useTribeEvents(TRIBE_ID), village: useVillageEvents('east-side'), publish: useNostrPublish() };
      received.push(...[...(app.tribe.data ?? []), ...(app.village.data ?? [])].map(title));
      return app;
    }, { wrapper });
    const bothShow = (count: number) => waitFor(() => {
      expect(result.current.tribe.data).toHaveLength(count);
      expect(result.current.village.data).toHaveLength(count);
    });
    await bothShow(4);
    const page = () => <EventView eventId={eventId(MEMBERS_ONLY)} />;
    const view = render(page(), { wrapper });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Members planning' })).toBeInTheDocument());

    // The owner removes the member, in this app.
    viewer = OWNER;
    rerender();
    view.rerender(page());
    await act(async () => {
      await result.current.publish.mutateAsync({
        kind: 34550, content: '', created_at: tribe.created_at + 60,
        tags: tribe.tags.filter(([name, pubkey]) => !(name === 'p' && pubkey === MEMBER)),
      });
    });

    // The removed member looks again. Their lists were cached a moment ago, with the old
    // member list; from the first render on they hold no tribe-only event.
    received.length = 0;
    const watch = watchForRestricted();
    viewer = MEMBER;
    rerender();
    view.rerender(page());
    await bothShow(2);
    await waitFor(() => expect(screen.getByText(/is shown only to members of its tribe/i)).toBeInTheDocument());
    watch.stop();
    expect(received.filter(text => MEMBERS_EVENTS.includes(text))).toEqual([]);
    expect([...watch.seen]).toEqual([]);

    // And someone the owner adds sees them without a reload.
    viewer = OWNER;
    rerender();
    await act(async () => {
      await result.current.publish.mutateAsync({
        kind: 34550, content: '', created_at: tribe.created_at + 120,
        tags: [...tribe.tags, ['p', STRANGER, '', 'member']],
      });
    });
    viewer = STRANGER;
    rerender();
    view.rerender(page());
    await bothShow(4);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Members planning' })).toBeInTheDocument());
  });
});

describe('membership that is not known yet', () => {
  it('holds a tribe-only event back until the member list arrives, then shows it to a member', async () => {
    viewer = MEMBER;
    let arrive: () => void = () => undefined;
    tribeLookup = new Promise<void>(resolve => { arrive = resolve; });
    render(<TestApp><EventView eventId={eventId(MEMBERS_ONLY)} /></TestApp>);

    // The event itself has loaded; who may see it has not.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(shownTitles()).toEqual([]);
    expect(screen.queryByText(/is shown only to/i)).not.toBeInTheDocument();

    await act(async () => { arrive(); });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Members planning' })).toBeInTheDocument());
  });

  it('never shows it to someone who turns out not to be a member', async () => {
    viewer = STRANGER;
    let arrive: () => void = () => undefined;
    tribeLookup = new Promise<void>(resolve => { arrive = resolve; });
    const watch = watchForRestricted();
    render(<TestApp><EventView eventId={eventId(MEMBERS_ONLY)} /></TestApp>);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    await act(async () => { arrive(); });
    await waitFor(() => expect(screen.getByText(/is shown only to/i)).toBeInTheDocument());
    watch.stop();
    expect([...watch.seen]).toEqual([]);
  });
});

describe('when the member list cannot be read', () => {
  beforeEach(() => { tribeLookup = 'fails'; });

  it('says so for a tribe-only event instead of showing or refusing it, and can retry', async () => {
    viewer = MEMBER;
    const watch = watchForRestricted();
    render(<TestApp><EventView eventId={eventId(MEMBERS_ONLY)} /></TestApp>);
    await waitFor(() => expect(screen.getByText(/could not check/i)).toBeInTheDocument());
    watch.stop();
    expect([...watch.seen]).toEqual([]);
    expect(screen.queryByText(/is shown only to/i)).not.toBeInTheDocument();

    tribeLookup = 'ok';
    await act(async () => { screen.getByRole('button', { name: /try again/i }).click(); });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Members planning' })).toBeInTheDocument());
  });

  it('still opens public events, and restricted ones for their organizer and invitees', async () => {
    for (const [who, event] of [[STRANGER, OPEN], [undefined, OPEN_BY_OWNER], [HOST, MEMBERS_ONLY], [INVITEE, INVITED]] as const) {
      viewer = who;
      const view = render(<TestApp><EventView eventId={eventId(event)} /></TestApp>);
      await waitFor(() => expect(screen.getByRole('heading', { name: title(event) })).toBeInTheDocument());
      view.unmount();
    }
  });

  it('keeps public events in the tribe list and leaves restricted ones out', async () => {
    // Without the member list the tribe feed only trusts the tribe creator's own posts.
    viewer = MEMBER;
    const { result } = renderHook(() => useTribeEvents(TRIBE_ID), { wrapper: TestApp });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map(title)).toEqual(['Owner picnic']);

    viewer = OWNER;
    const owner = renderHook(() => useTribeEvents(TRIBE_ID), { wrapper: TestApp });
    await waitFor(() => expect(owner.result.current.isSuccess).toBe(true));
    expect(owner.result.current.data?.map(title).sort()).toEqual(['Owner members night', 'Owner picnic']);
  });
});
