import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

export interface NostrShareLinks {
  web: string;
  naddr: string;
  /** Addressable coordinate `kind:pubkey:d`, used to tag announcement notes. */
  coordinate: string;
  text: string;
}

function dTagOf(event: NostrEvent): string {
  return event.tags.find(([name]) => name === 'd')?.[1] ?? '';
}

function addressLinks(kind: number, pubkey: string, identifier: string, path: string, text: (web: string, naddr: string) => string): NostrShareLinks {
  const naddr = nip19.naddrEncode({ kind, pubkey, identifier });
  const web = `${window.location.origin}/${path}/${pubkey}:${encodeURIComponent(identifier)}`;
  return { web, naddr, coordinate: `${kind}:${pubkey}:${identifier}`, text: text(web, naddr) };
}

export function createTribeShareLinks(tribePubkey: string, dTag: string, tribeName: string): NostrShareLinks {
  return addressLinks(34550, tribePubkey, dTag, 'tribe',
    (web, naddr) => `Join the ${tribeName} tribe! ${web} or nostr:${naddr}`);
}

/** Share links for an event, using its real kind (36959 enhanced or 31923 calendar). */
export function createEventShareLinks(event: NostrEvent, eventTitle: string): NostrShareLinks {
  return addressLinks(event.kind, event.pubkey, dTagOf(event), 'event',
    (web, naddr) => `RSVP for ${eventTitle}! ${web} or nostr:${naddr}`);
}

export function createStoryShareLinks(story: NostrEvent, storyTitle: string): NostrShareLinks {
  return addressLinks(story.kind, story.pubkey, dTagOf(story), 'story',
    (web, naddr) => `Check out this story: ${storyTitle} ${web} or nostr:${naddr}`);
}
