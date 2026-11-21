// @vitest-environment node
// Signing needs Node's Uint8Array (jsdom's fails @noble/hashes' type check).
import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';
import { NSecSigner } from '@nostrify/nostrify';
import { buildEnhancedEventTemplate, buildPrivateDetailsMessage, type EnhancedEventInput } from '@/hooks/useEvents';
import { newTribeTags } from '@/lib/tribes';
import { unwrapDirectMessage, wrapDirectMessage } from '@/lib/nip17';
import { EVENT_PUBLIC_FIELDS, TRIBE_PUBLIC_FIELDS, undisclosedTags } from '@/lib/publicFields';

const SECRET_DETAILS = 'CONFIDENTIAL-gate-code-4821';
const SECRET_ADDRESS = 'CONFIDENTIAL-14-Elm-Street';

const organizerKey = generateSecretKey();
const organizer = getPublicKey(organizerKey);
const inviteeKey = generateSecretKey();
const invitee = getPublicKey(inviteeKey);

/** Signs a template as the app would (useNostrPublish adds a client tag on https). */
function sign(template: { kind: number; content: string; tags: string[][]; created_at: number }) {
  return finalizeEvent({ ...template, tags: [...template.tags, ['client', 'village.example']] }, organizerKey);
}

const restrictedEvent: EnhancedEventInput = {
  tribe: `${organizer}:green-thumbs`,
  title: 'Seed swap',
  summary: 'Bring seeds',
  content: 'Swap seeds with neighbours.',
  start: 1_800_000_000,
  end: 1_800_003_600,
  place: 'Near the library',
  lat: 42.33,
  lon: -83.04,
  image: 'https://example.com/seeds.jpg',
  etypes: ['potluck', 'game'],
  visibility: 'private',
  villages: ['eastside'],
  invitees: [invitee],
  typeSpecificData: { food: ['salad'], diet_notes: 'vegan', game_kind: 'trivia' },
};

describe('restricted event publication', () => {
  it('discloses every published tag of a signed invite-only event', () => {
    const { template } = buildEnhancedEventTemplate(restrictedEvent, 1_799_000_000);
    const signed = sign(template);

    expect(verifyEvent(signed)).toBe(true);
    // A relay reader sees the invitee list and the visibility hint, and the notice says so
    expect(signed.tags).toContainEqual(['p', invitee]);
    expect(signed.tags).toContainEqual(['visibility', 'private']);
    expect(undisclosedTags(signed.tags, EVENT_PUBLIC_FIELDS)).toEqual([]);
  });

  it('never publishes private details or an exact location, even if a caller passes them', () => {
    const leaky = { ...restrictedEvent, privateDetails: SECRET_DETAILS, exactLocation: SECRET_ADDRESS } as EnhancedEventInput;
    const signed = sign(buildEnhancedEventTemplate(leaky).template);

    const published = JSON.stringify(signed);
    expect(published).not.toContain(SECRET_DETAILS);
    expect(published).not.toContain(SECRET_ADDRESS);
  });

  it('carries private details only inside the encrypted invitation', async () => {
    const message = buildPrivateDetailsMessage({
      eventId: `${organizer}:seed-swap`,
      eventTitle: 'Seed swap',
      privateDetails: SECRET_DETAILS,
      exactLocation: SECRET_ADDRESS,
      organizer,
    });
    const { recipientWrap } = await wrapDirectMessage(new NSecSigner(organizerKey), organizer, invitee, message);

    // What a relay stores: no plaintext
    expect(JSON.stringify(recipientWrap)).not.toContain(SECRET_DETAILS);
    expect(JSON.stringify(recipientWrap)).not.toContain(SECRET_ADDRESS);

    // What the invitee reads
    const opened = await unwrapDirectMessage(new NSecSigner(inviteeKey), recipientWrap);
    expect(opened?.content).toContain(SECRET_DETAILS);
    expect(opened?.content).toContain(SECRET_ADDRESS);
    expect(opened?.content).toContain('The event listing itself is public');
  });
});

describe('unlisted tribe publication', () => {
  it('keeps the legacy private flag and discloses every tag', () => {
    const tags = newTribeTags({
      dTag: 'tribe-1', creator: organizer, name: 'Green Thumbs', description: 'Gardeners',
      location: 'Eastside', image: 'https://example.com/t.jpg', listed: false, open: false,
    });
    const signed = sign({ kind: 34550, content: 'Gardeners', tags, created_at: 1_799_000_000 });

    expect(verifyEvent(signed)).toBe(true);
    expect(signed.tags).toContainEqual(['private']);
    expect(signed.tags).toContainEqual(['closed']);
    expect(signed.tags).toContainEqual(['p', organizer, '', 'admin']);
    expect(undisclosedTags(signed.tags, TRIBE_PUBLIC_FIELDS)).toEqual([]);
  });
});
