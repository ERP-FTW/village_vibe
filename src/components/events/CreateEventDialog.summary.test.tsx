import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { NostrContext } from '@nostrify/react';
import { NLogin, NostrLoginProvider } from '@nostrify/react/login';
import { MockRelay, genEvent } from '@nostrify/nostrify/test';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { NostrEvent, NPool } from '@nostrify/nostrify';

import { AppProvider } from '@/components/AppProvider';
import { CreateEventDialog } from './CreateEventDialog';
import { EventView } from './EventView';

// jsdom's TextEncoder returns a Uint8Array from another realm, which @noble/hashes rejects,
// so nostr-tools cannot sign or hash events here. Re-wrap the bytes before nostr-tools loads.
vi.hoisted(() => {
  const JsdomTextEncoder = globalThis.TextEncoder;
  globalThis.TextEncoder = class extends JsdomTextEncoder {
    encode(input?: string) {
      return new Uint8Array(super.encode(input));
    }
  };
});

const LOGIN_KEY = 'summary-test-login';
const TITLE = 'Mack test meetup';
const SUMMARY = 'Bring a laptop — demos welcome.';
const DESCRIPTION = 'Doors open at six. The workshop follows.';

/** In-memory relay plus the real app providers, with a fresh QueryClient per mount. */
function Harness({ relay, children }: { relay: MockRelay; children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }));

  return (
    <AppProvider storageKey="summary-test-app" defaultConfig={{ theme: 'light', relayUrl: 'wss://relay.invalid' }}>
      <QueryClientProvider client={queryClient}>
        <NostrLoginProvider storageKey={LOGIN_KEY}>
          <NostrContext.Provider value={{ nostr: relay as unknown as NPool }}>
            <MemoryRouter>{children}</MemoryRouter>
          </NostrContext.Provider>
        </NostrLoginProvider>
      </QueryClientProvider>
    </AppProvider>
  );
}

/** Fill and submit the real dialog; return the serialized event handed to the relay. */
async function submitMeetup(summary: string): Promise<string> {
  const relay = new MockRelay();
  const published: string[] = [];
  const store = relay.event.bind(relay);
  relay.event = async (event: NostrEvent) => {
    published.push(JSON.stringify(event));
    return store(event);
  };

  const user = userEvent.setup();
  const view = render(
    <Harness relay={relay}>
      <CreateEventDialog tribeId={`${getPublicKey(generateSecretKey())}:test-tribe`}>
        <button type="button">Open create</button>
      </CreateEventDialog>
    </Harness>,
  );

  await user.click(screen.getByRole('button', { name: 'Open create' }));
  await user.type(screen.getByLabelText('Event Title *'), TITLE);
  if (summary) {
    await user.type(screen.getByLabelText('Short Summary'), summary);
  }
  await user.type(screen.getByLabelText(/Description/), DESCRIPTION);
  await user.click(screen.getByRole('checkbox', { name: /Meetup/ }));

  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  fireEvent.change(screen.getByLabelText('Date *'), { target: { value: nextWeek } });
  fireEvent.change(screen.getByLabelText('Time *'), { target: { value: '18:00' } });
  await user.type(screen.getByLabelText('Location'), 'Community Hall');

  await user.click(screen.getByRole('button', { name: 'Create Event' }));
  await waitFor(() => expect(published).toHaveLength(1));

  view.unmount();
  return published[0];
}

/** Mount the detail view on a brand-new relay and query cache holding only `event`. */
async function reopen(event: NostrEvent) {
  const relay = new MockRelay();
  await relay.event(event);
  const dTag = event.tags.find(([name]) => name === 'd')?.[1];

  render(
    <Harness relay={relay}>
      <EventView eventId={`${event.pubkey}:${dTag}`} />
    </Harness>,
  );

  return screen.findByRole('heading', { level: 1, name: event.tags.find(([n]) => n === 'title')?.[1] });
}

describe('CreateEventDialog short summary', () => {
  let quietLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(LOGIN_KEY, JSON.stringify([NLogin.fromNsec(nip19.nsecEncode(generateSecretKey()))]));
    quietLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    quietLog.mockRestore();
  });

  it('publishes the entered summary as one summary tag and shows it under the title after reopening', async () => {
    const captured = await submitMeetup(SUMMARY);
    const event: NostrEvent = JSON.parse(captured);

    expect(event.kind).toBe(36959);
    expect(event.tags.filter(([name]) => name === 'summary')).toEqual([['summary', SUMMARY]]);
    expect(event.content).toBe(DESCRIPTION);

    const heading = await reopen(event);
    const summary = await screen.findByText(SUMMARY);
    expect(heading.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.parentElement?.parentElement).toContainElement(summary);
    expect(screen.getAllByText(DESCRIPTION).length).toBeGreaterThan(0);
  });

  it.each([['blank', ''], ['whitespace-only', '   ']])('omits the summary tag for a %s summary', async (_label, summary) => {
    const event: NostrEvent = JSON.parse(await submitMeetup(summary));

    expect(event.kind).toBe(36959);
    expect(event.tags.filter(([name]) => name === 'summary')).toEqual([]);
    expect(event.content).toBe(DESCRIPTION);

    const heading = await reopen(event);
    expect(heading.parentElement?.parentElement?.querySelector('p')).toBeNull();
    expect(screen.getAllByText(DESCRIPTION).length).toBeGreaterThan(0);
  });

  it('still opens an older meetup that has no summary tag', async () => {
    const older = genEvent({
      kind: 36959,
      content: 'An older meetup body.',
      created_at: Math.floor(Date.now() / 1000) - 86400,
      tags: [
        ['d', 'older-meetup'],
        ['tribe', 'test-tribe'],
        ['title', 'Older meetup'],
        ['start', String(Math.floor(Date.now() / 1000) + 86400)],
        ['place', 'Library'],
        ['l', '47.6062,-122.3321'],
        ['visibility', 'public'],
      ],
    });

    const heading = await reopen(older);
    expect(heading.parentElement?.parentElement?.querySelector('p')).toBeNull();
    expect(screen.getAllByText('An older meetup body.').length).toBeGreaterThan(0);
  });
});
