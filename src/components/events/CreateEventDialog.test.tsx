// First: lets the real signing code run under jsdom (see the file).
import '@/test/signingInJsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { generateSecretKey, getPublicKey, nip19, verifyEvent } from 'nostr-tools';
import { NSecSigner, type NostrEvent, type NostrFilter } from '@nostrify/nostrify';
import { unwrapDirectMessage } from '@/lib/nip17';
import { TestApp } from '@/test/TestApp';

/**
 * The event form, used the way a host uses it: choose who the event is for, name the
 * invitees, write what only they are told, publish, and recover from a delivery that failed.
 *
 * Only the edges are stood in for: the relays (in memory, recording every publish attempt)
 * and the logged-in account. Signing, NIP-44, the NIP-17 gift wraps, the invitation sender,
 * the outbox and the recovery panel are the real ones, so the test can open each guest's
 * invitation with that guest's key and read what they were sent.
 */

const TRIBE = `${'a'.repeat(64)}:garden`;
const PHRASE = 'CONFIDENTIAL-PHRASE-door-code-4417';
const ADDRESS = 'EXACT-ADDRESS-12-Elm-Street-side-gate';

const hostKey = generateSecretKey();
const HOST = getPublicKey(hostKey);
const hostSigner = new NSecSigner(hostKey);

// --- relays: every publish attempt is recorded, accepted or not --------------------------
interface Attempt { event: NostrEvent; relays?: string[]; accepted: boolean }
let attempts: Attempt[] = [];
/** Which publishes the relays refuse. */
let refuses: (event: NostrEvent, relays?: string[]) => boolean = () => false;
/** NIP-17 inbox relays people advertise (kind 10050). */
let inboxes: Record<string, string[]> = {};
const relays = {
  async query(filters: NostrFilter[]): Promise<NostrEvent[]> {
    const [filter] = filters;
    if (!filter.kinds?.includes(10050)) return [];
    return (filter.authors ?? []).filter(author => inboxes[author]).map(author => ({
      id: author, pubkey: author, kind: 10050, created_at: 1, content: '', sig: '',
      tags: inboxes[author].map(url => ['relay', url]),
    }));
  },
  async event(event: NostrEvent, opts?: { relays?: string[] }): Promise<void> {
    const accepted = !refuses(event, opts?.relays);
    attempts.push({ event, relays: opts?.relays, accepted });
    if (!accepted) throw new Error('blocked: relay unavailable');
  },
};

// --- the host's signer, which can be made to refuse ---------------------------------------
let signerRefuses: (request: { kind?: number; encryptTo?: string }) => boolean = () => false;
let signedKinds: number[] = [];
const signer = {
  getPublicKey: () => hostSigner.getPublicKey(),
  async signEvent(template: Parameters<typeof hostSigner.signEvent>[0]) {
    if (signerRefuses({ kind: template.kind })) throw new Error('User rejected the request');
    signedKinds.push(template.kind);
    return hostSigner.signEvent(template);
  },
  nip44: {
    async encrypt(pubkey: string, text: string) {
      if (signerRefuses({ encryptTo: pubkey })) throw new Error('User rejected the request');
      return hostSigner.nip44.encrypt(pubkey, text);
    },
    decrypt: (pubkey: string, text: string) => hostSigner.nip44.decrypt(pubkey, text),
  },
};
const host = { pubkey: HOST, signer };
const toast = vi.fn();

vi.mock('@nostrify/react', async (importOriginal) => ({
  ...await importOriginal<typeof import('@nostrify/react')>(),
  useNostr: () => ({ nostr: relays }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: host }) }));
vi.mock('@/hooks/useAuthor', () => ({ useAuthor: () => ({ data: undefined }) }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast }) }));

const { CreateEventDialog } = await import('./CreateEventDialog');

// --- people ---------------------------------------------------------------------------------
function guest() {
  const key = generateSecretKey();
  return { key, pubkey: getPublicKey(key) };
}
type Guest = ReturnType<typeof guest>;

/** The meetup events offered to the relays, and the invitations offered for one person. */
const meetups = () => attempts.filter(({ event }) => event.kind === 36959);
const wrapsFor = (pubkey: string) => attempts.filter(({ event }) => event.kind === 1059 && event.tags.some(([name, value]) => name === 'p' && value === pubkey));
const delivered = (list: Attempt[]) => list.filter(({ accepted }) => accepted);
/** What a guest reads when they open the invitation they received. */
async function invitationReadBy({ key, pubkey }: Guest): Promise<string> {
  const [received, ...extra] = delivered(wrapsFor(pubkey));
  expect(extra).toEqual([]);
  const message = await unwrapDirectMessage(new NSecSigner(key) as Parameters<typeof unwrapDirectMessage>[0], received.event);
  expect(message?.pubkey).toBe(HOST);
  return message?.content ?? '';
}

// --- the form ---------------------------------------------------------------------------------
const user = userEvent.setup();
const field = (label: RegExp) => screen.getByLabelText(label);

async function openForm() {
  render(<TestApp><CreateEventDialog tribeId={TRIBE}><button>New event</button></CreateEventDialog></TestApp>);
  await user.click(screen.getByRole('button', { name: 'New event' }));
  await screen.findByRole('dialog');
}
async function fillListing(title: string) {
  await user.type(field(/Event Title/), title);
  await user.type(field(/^Description/), 'Bring a dish to share.');
  await user.click(screen.getByRole('checkbox', { name: /Meetup/ }));
  fireEvent.change(field(/^Date/), { target: { value: '2031-06-07' } });
  fireEvent.change(field(/^Time/), { target: { value: '18:30' } });
  await user.type(field(/Location \(public\)/), 'Near the library');
}
async function invite(text: string, how: 'button' | 'enter' = 'button') {
  await user.click(field(/Invite people/));
  await user.paste(text);
  if (how === 'enter') await user.keyboard('{Enter}');
  else await user.click(screen.getByRole('button', { name: 'Add' }));
}
const invitedList = () => within(screen.getByRole('list', { name: /^Invited/ })).getAllByRole('listitem');
const submit = () => user.click(screen.getByRole('button', { name: 'Create Event' }));
const closed = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
const toasts = () => toast.mock.calls.map(([options]) => `${options.title}: ${options.description}`);

let logged: string[] = [];
let consoleSpies: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  attempts = []; inboxes = {}; signedKinds = []; logged = [];
  refuses = () => false; signerRefuses = () => false;
  toast.mockClear();
  localStorage.clear(); sessionStorage.clear();
  // Everything the app logs is kept, to check that the confidential text is never logged.
  consoleSpies = (['log', 'info', 'warn', 'error'] as const).map(method =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')); }));
});
afterEach(() => { cleanup(); consoleSpies.forEach(spy => spy.mockRestore()); });

/** Nothing outside the encrypted invitations may carry the confidential text. */
function expectConfidentialTextNowhereElse() {
  for (const { event } of attempts) {
    expect(JSON.stringify(event)).not.toContain(PHRASE);
    expect(JSON.stringify(event)).not.toContain(ADDRESS);
  }
  const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
  for (const text of [stored, logged.join('\n'), toasts().join('\n')]) {
    expect(text).not.toContain(PHRASE);
    expect(text).not.toContain(ADDRESS);
  }
}

describe('inviting people to an event', () => {
  it('publishes once, reaches every guest, and retries only the delivery that failed', async () => {
    const [ana, ben, cam] = [guest(), guest(), guest()];
    // Cam reads invitations on an inbox relay that is down for now.
    inboxes = { [cam.pubkey]: ['wss://inbox.cam.example'] };
    let camInboxDown = true;
    refuses = (_event, to) => camInboxDown && to?.includes('wss://inbox.cam.example') === true;

    await openForm();
    await fillListing('Invited dinner');
    expect(screen.queryByLabelText(/Invite people/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /People I invite/ }));

    // Three people, given in every accepted form and more than once.
    await invite([
      nip19.npubEncode(ana.pubkey), nip19.nprofileEncode({ pubkey: ben.pubkey }), cam.pubkey,
      ana.pubkey, `nostr:${nip19.npubEncode(ben.pubkey)}`, cam.pubkey.toUpperCase(),
    ].join('\n'));
    expect(invitedList()).toHaveLength(3);
    await invite(nip19.npubEncode(ana.pubkey), 'enter');
    expect(invitedList()).toHaveLength(3);

    await user.type(field(/Exact location/), ADDRESS);
    await user.type(field(/Details for invitees/), `Use the ${PHRASE}.`);
    expect(field(/Send each of them the details/)).toBeChecked();
    // The public and the invitee-only location are separate fields.
    expect(field(/Location \(public\)/)).toHaveValue('Near the library');

    await submit();

    // One delivery failed: the form is replaced by the recovery panel, which takes focus.
    const panel = await screen.findByRole('status');
    expect(panel).toHaveTextContent('Private details reached 2 of 3 invitees');
    expect(within(panel).getAllByRole('listitem')).toHaveLength(1);
    expect(document.activeElement?.contains(panel)).toBe(true);
    expect(meetups()).toHaveLength(1);
    expect(delivered(wrapsFor(ana.pubkey))).toHaveLength(1);
    expect(delivered(wrapsFor(ben.pubkey))).toHaveLength(1);
    expect(delivered(wrapsFor(cam.pubkey))).toHaveLength(0);
    expect(wrapsFor(cam.pubkey)).toHaveLength(1);

    // The relay comes back; the host retries from the same form.
    camInboxDown = false;
    await user.click(within(panel).getByRole('button', { name: /Retry what's missing/ }));
    await closed();
    expect(toasts()).toContain('Invitations delivered: Every invitee now has the private details.');

    // One event, never published again.
    expect(meetups()).toHaveLength(1);
    expect(signedKinds.filter(kind => kind === 36959)).toHaveLength(1);
    const [{ event: listing, accepted }] = meetups();
    expect(accepted).toBe(true);
    expect(verifyEvent(listing)).toBe(true);
    expect(listing.pubkey).toBe(HOST);
    expect(listing.tags).toContainEqual(['visibility', 'private']);
    expect(listing.tags.filter(([name]) => name === 'p')).toEqual([['p', ana.pubkey], ['p', ben.pubkey], ['p', cam.pubkey]]);
    expect(listing.tags).toContainEqual(['place', 'Near the library']);

    // Everyone reached, each exactly once: nothing was sent again to Ana or Ben.
    expect(wrapsFor(ana.pubkey)).toHaveLength(1);
    expect(wrapsFor(ben.pubkey)).toHaveLength(1);
    expect(wrapsFor(cam.pubkey).map(({ accepted }) => accepted)).toEqual([false, true]);
    expect(wrapsFor(cam.pubkey)[0].event.id).toBe(wrapsFor(cam.pubkey)[1].event.id);   // the same signed message
    expect(delivered(wrapsFor(cam.pubkey))[0].relays).toEqual(['wss://inbox.cam.example']);
    // The host's own copies, one per delivered invitation.
    expect(delivered(wrapsFor(HOST))).toHaveLength(3);
    expect(wrapsFor(HOST)).toHaveLength(3);

    // Each guest reads the details; nobody else can.
    for (const person of [ana, ben, cam]) {
      const message = await invitationReadBy(person);
      expect(message).toContain('Invited dinner');
      expect(message).toContain(`Use the ${PHRASE}.`);
      expect(message).toContain(`Exact Location: ${ADDRESS}`);
      expect(message).toContain(`${HOST}:${listing.tags.find(([name]) => name === 'd')?.[1]}`);
    }
    expectConfidentialTextNowhereElse();
  });

  it('stops before signing when an entry is not a person, and keeps what was valid', async () => {
    const ana = guest();
    await openForm();
    await fillListing('Invited dinner');
    await user.click(screen.getByRole('radio', { name: /People I invite/ }));

    // No invitee at all
    await submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one person to invite.');
    expect(field(/Invite people/)).toHaveFocus();
    expect(field(/Invite people/)).toHaveAttribute('aria-invalid', 'true');

    // A valid key together with entries that are not keys, left unadded in the field
    const nsec = nip19.nsecEncode(generateSecretKey());
    await user.click(field(/Invite people/));
    await user.paste(`${nip19.npubEncode(ana.pubkey)} npub1notakey ${nsec} ${HOST}`);
    await submit();
    const problems = screen.getByRole('alert');
    expect(problems).toHaveTextContent('“npub1notakey” is not a valid npub, nprofile or 64-character hex key.');
    expect(problems).toHaveTextContent('“nsec1…” is a secret key.');
    expect(problems).toHaveTextContent('You are the organizer');
    expect(invitedList()).toHaveLength(1);
    // Only the entry to correct stays in the field; the secret key is gone from the page.
    expect(field(/Invite people/)).toHaveValue('npub1notakey');
    expect(field(/Invite people/)).toHaveFocus();
    expect(document.body.innerHTML).not.toContain(nsec);
    expect(signedKinds).toEqual([]);
    expect(attempts).toEqual([]);

    // Corrected: the same form publishes.
    await user.clear(field(/Invite people/));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await submit();
    await closed();
    expect(meetups()).toHaveLength(1);
    expect(meetups()[0].event.tags.filter(([name]) => name === 'p')).toEqual([['p', ana.pubkey]]);
    expect(delivered(wrapsFor(ana.pubkey))).toHaveLength(1);
  });

  it('keeps the whole draft when the event cannot be signed or published, and publishes once after that', async () => {
    const ana = guest();
    await openForm();
    await fillListing('Invited dinner');
    await user.click(screen.getByRole('radio', { name: /People I invite/ }));
    await invite(nip19.npubEncode(ana.pubkey));
    await user.type(field(/Exact location/), ADDRESS);
    await user.type(field(/Details for invitees/), PHRASE);

    const draftIsIntact = () => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(field(/Event Title/)).toHaveValue('Invited dinner');
      expect(screen.getByRole('radio', { name: /People I invite/ })).toBeChecked();
      expect(invitedList()).toHaveLength(1);
      expect(field(/Exact location/)).toHaveValue(ADDRESS);
      expect(field(/Details for invitees/)).toHaveValue(PHRASE);
    };

    // The signer declines the event.
    signerRefuses = ({ kind }) => kind === 36959;
    await submit();
    await waitFor(() => expect(toasts()).toContain('Error: Failed to create event: User rejected the request'));
    draftIsIntact();
    expect(attempts).toEqual([]);

    // The signer agrees, the relays refuse the event.
    signerRefuses = () => false;
    refuses = (event) => event.kind === 36959;
    await submit();
    await waitFor(() => expect(toasts()).toContain('Error: Failed to create event: blocked: relay unavailable'));
    draftIsIntact();
    expect(delivered(meetups())).toEqual([]);
    // No invitation goes out for an event that was not published.
    expect(wrapsFor(ana.pubkey)).toEqual([]);

    refuses = () => false;
    await submit();
    await closed();
    expect(delivered(meetups())).toHaveLength(1);
    expect(delivered(wrapsFor(ana.pubkey))).toHaveLength(1);
    expect(await invitationReadBy(ana)).toContain(PHRASE);
    expectConfidentialTextNowhereElse();
  });

  it('recovers when the signer refuses an invitation after the event is out', async () => {
    const [ana, ben] = [guest(), guest()];
    await openForm();
    await fillListing('Invited dinner');
    await user.click(screen.getByRole('radio', { name: /People I invite/ }));
    await invite(`${ana.pubkey} ${ben.pubkey}`);
    await user.type(field(/Details for invitees/), PHRASE);

    signerRefuses = ({ encryptTo }) => encryptTo === ben.pubkey;
    await submit();
    const panel = await screen.findByRole('status');
    expect(panel).toHaveTextContent('Private details reached 1 of 2 invitees');
    expect(panel).toHaveTextContent('User rejected the request');
    expect(wrapsFor(ben.pubkey)).toEqual([]);

    signerRefuses = () => false;
    await user.click(within(panel).getByRole('button', { name: /Retry what's missing/ }));
    await closed();
    expect(meetups()).toHaveLength(1);
    expect(wrapsFor(ana.pubkey)).toHaveLength(1);
    expect(wrapsFor(ben.pubkey)).toHaveLength(1);
    expect(await invitationReadBy(ben)).toContain(PHRASE);
    expectConfidentialTextNowhereElse();
  });

  it('forgets what was written for invitees when the form is dismissed, and keeps the listing draft', async () => {
    const ana = guest();
    await openForm();
    await fillListing('Invited dinner');
    await user.click(screen.getByRole('radio', { name: /People I invite/ }));
    await invite(ana.pubkey);
    const reopen = async () => {
      await closed();
      await user.click(screen.getByRole('button', { name: 'New event' }));
      await screen.findByRole('dialog');
    };
    const dismissals = [
      () => user.click(screen.getByRole('button', { name: 'Cancel' })),
      () => user.keyboard('{Escape}'),
      () => user.click(screen.getByRole('button', { name: 'Close' })),
    ];
    for (const dismissForm of dismissals) {
      await user.type(field(/Exact location/), ADDRESS);
      await user.type(field(/Details for invitees/), PHRASE);
      await dismissForm();
      await reopen();
      // The public draft and the invitee list are still there; the private text is not.
      expect(field(/Event Title/)).toHaveValue('Invited dinner');
      expect(screen.getByRole('radio', { name: /People I invite/ })).toBeChecked();
      expect(invitedList()).toHaveLength(1);
      expect(field(/Exact location/)).toHaveValue('');
      expect(field(/Details for invitees/)).toHaveValue('');
      expect(document.body.innerHTML).not.toContain(PHRASE);
      expect(document.body.innerHTML).not.toContain(ADDRESS);
    }
    expect(attempts).toEqual([]);
    expectConfidentialTextNowhereElse();
  });

  it('names the invitees without messaging them when the host turns invitations off', async () => {
    const ana = guest();
    await openForm();
    await fillListing('Invited dinner');
    await user.click(screen.getByRole('radio', { name: /People I invite/ }));
    await invite(ana.pubkey);
    await user.type(field(/Details for invitees/), PHRASE);
    await user.click(field(/Send each of them the details/));
    expect(screen.queryByLabelText(/Details for invitees/)).not.toBeInTheDocument();
    expect(screen.getByText(/No message will be sent/)).toBeInTheDocument();

    await submit();
    await closed();
    expect(meetups()[0].event.tags).toContainEqual(['p', ana.pubkey]);
    expect(attempts.filter(({ event }) => event.kind !== 36959)).toEqual([]);
    expectConfidentialTextNowhereElse();
  });
});

describe('the ordinary event form', () => {
  it('publishes a public event by default, with no invitees and no messages', async () => {
    await openForm();
    expect(screen.getByRole('radio', { name: /Everyone/ })).toBeChecked();
    await fillListing('Open potluck');
    await submit();
    await closed();

    expect(attempts).toHaveLength(1);
    const [{ event }] = meetups();
    expect(verifyEvent(event)).toBe(true);
    expect(event.content).toBe('Bring a dish to share.');
    expect(event.tags).toContainEqual(['visibility', 'public']);
    expect(event.tags).toContainEqual(['title', 'Open potluck']);
    expect(event.tags).toContainEqual(['a', `34550:${TRIBE}`]);
    expect(event.tags.filter(([name]) => name === 'p')).toEqual([]);
    expect(toasts()).toEqual(['Event published: Your event has been published.']);
  });

  it('publishes a tribe-members event without invitees, whatever was typed for invitees before', async () => {
    const ana = guest();
    await openForm();
    await fillListing('Members planning');
    await user.click(screen.getByRole('radio', { name: /People I invite/ }));
    await invite(ana.pubkey);
    await user.type(field(/Details for invitees/), PHRASE);
    await user.click(screen.getByRole('radio', { name: /Members of this tribe/ }));
    expect(screen.queryByLabelText(/Invite people/)).not.toBeInTheDocument();

    await submit();
    await closed();
    expect(attempts).toHaveLength(1);
    expect(meetups()[0].event.tags).toContainEqual(['visibility', 'tribe-only']);
    expect(meetups()[0].event.tags.filter(([name]) => name === 'p')).toEqual([]);
    expectConfidentialTextNowhereElse();
  });

  it('says what is public before anything is published', async () => {
    await openForm();
    const audience = screen.getByRole('radiogroup', { name: /Who Village Vibe shows this event to/ });
    expect(audience).toHaveAccessibleDescription(/list of people you invite are public on Nostr/);
    expect(audience).toHaveAccessibleDescription(/Only what you send by direct message is encrypted/);
    await user.click(screen.getByRole('radio', { name: /People I invite/ }));
    expect(field(/Invite people/)).toHaveAccessibleDescription(/named on the public listing/);
    expect(screen.getByText(/Invitee list \(invite-only events\)/)).toBeInTheDocument();
    expect(screen.getByText(/exact location and the details for invitees are not in this list/)).toBeInTheDocument();
  });

  it('can be completed from the keyboard', async () => {
    const ana = guest();
    await openForm();
    await fillListing('Invited dinner');

    // Arrow keys move through the three audiences. The key is held for a moment, as a
    // person's key press is: the radio group selects on the focus move that follows the press.
    const arrowDownTo = async (name: RegExp) => {
      await user.keyboard('{ArrowDown>}');
      await waitFor(() => expect(screen.getByRole('radio', { name })).toBeChecked());
      await user.keyboard('{/ArrowDown}');
    };
    screen.getByRole('radio', { name: /Everyone/ }).focus();
    await arrowDownTo(/Members of this tribe/);
    await arrowDownTo(/People I invite/);
    expect(screen.getByRole('radio', { name: /People I invite/ })).toHaveFocus();

    // Tab reaches the invite field; Enter adds the person and stays there without submitting.
    await user.tab();
    expect(field(/Invite people/)).toHaveFocus();
    await user.paste(nip19.npubEncode(ana.pubkey));
    await user.keyboard('{Enter}');
    expect(invitedList()).toHaveLength(1);
    expect(field(/Invite people/)).toHaveFocus();
    expect(field(/Invite people/)).toHaveValue('');
    expect(attempts).toEqual([]);

    // Add, remove, the invitation switch and the two private fields follow in order.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Add' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /^Remove / })).toHaveFocus();
    await user.tab();
    expect(field(/Send each of them the details/)).toHaveFocus();
    await user.tab();
    expect(field(/Exact location/)).toHaveFocus();
    await user.keyboard('Side gate');
    await user.tab();
    expect(field(/Details for invitees/)).toHaveFocus();

    // Enter in a one-line field submits the form.
    field(/Exact location/).focus();
    await user.keyboard('{Enter}');
    await closed();
    expect(meetups()).toHaveLength(1);
    expect(delivered(wrapsFor(ana.pubkey))).toHaveLength(1);
  });
});
