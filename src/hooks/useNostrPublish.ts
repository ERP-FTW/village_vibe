import { useNostr } from '@nostrify/react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from './useCurrentUser';

type EventInput = Pick<NostrEvent, 'kind'> & Partial<Pick<NostrEvent, 'content' | 'tags' | 'created_at'>>;

function affectedQueries(event: NostrEvent): QueryKey[] {
  const tag = (name: string) => event.tags.find(([key]) => key === name)?.[1];
  const coordinate = `${event.pubkey}:${tag('d')}`;
  const referenced = tag('a')?.split(':').slice(1).join(':');
  switch (event.kind) {
    case 0: return [['author', event.pubkey], ['logins']];
    case 1: return tag('e') ? [['event-discussion', tag('e')]] : [];
    case 4: return [['direct-messages', event.pubkey, tag('p')], ['conversations', event.pubkey]];
    case 2073: return [['event-attendance', referenced]];
    case 31925: return [['event-rsvps', referenced], ['user-rsvp', referenced]];
    case 9021:
    case 9022: return [['join-requests', tag('h')], ['tribe-join-requests', tag('h')], ['tribes-card-statuses']];
    case 30078: return tag('d') === 'profile-privacy' ? [['profile-privacy', event.pubkey]] : [];
    // Moderation and promotion labels change what every feed shows.
    case 1985: return [['story-labels'], ['event-labels'], ['service-labels'],
      ['tribe-events'], ['village-events'], ['tribe-stories'], ['village-stories'], ['multi-village-stories'],
      ['tribe-services'], ['village-services']];
    case 34871: return [['service-matches']];
    case 34550: return [['tribe', coordinate], ['public-tribes'], ['my-tribes'], ['tribe-name', tag('d')],
      ['join-requests', coordinate],
      // Membership decides whose content the tribe feeds include,
      ['tribe-events', coordinate], ['tribe-stories', coordinate], ['tribe-services', coordinate],
      // and who is shown a tribe-only event wherever it is listed.
      ['village-events']];
    case 30627:
    case 38857: return [['service', coordinate], ['tribe-services'], ['village-services']];
    case 31923:
    case 36959: return [['event', coordinate], ['tribe-events'], ['village-events']];
    case 30023: return [['story', coordinate], ['tribe-stories'], ['village-stories'], ['multi-village-stories']];
    default: return [];
  }
}

export function useNostrPublish() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: EventInput) => {
      if (!user) throw new Error('User is not logged in');
      const tags = [...(input.tags ?? [])];
      if (location.protocol === 'https:' && !tags.some(([name]) => name === 'client')) {
        tags.push(['client', location.hostname]);
      }
      const event = await user.signer.signEvent({
        kind: input.kind,
        content: input.content ?? '',
        tags,
        created_at: input.created_at ?? Math.floor(Date.now() / 1000),
      });
      await nostr.event(event, { signal: AbortSignal.timeout(5000) });
      return event;
    },
    onSuccess: event => {
      if (event.kind === 34550) {
        const identifier = event.tags.find(([name]) => name === 'd')?.[1];
        client.setQueryData(['tribe', `${event.pubkey}:${identifier}`], event);
      }
      for (const queryKey of affectedQueries(event)) void client.invalidateQueries({ queryKey });
    },
  });
}
