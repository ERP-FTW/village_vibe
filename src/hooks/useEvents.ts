import { useSendDirectMessage } from './useSendDirectMessage';
import { useNostrPublish } from './useNostrPublish';
import { readVillageFeed } from '@/lib/villageFeed';
import { locationTags } from '@/lib/location';
import { villageList } from '@/lib/villages';
import { belongsToTribe, tribeCoordinate, tribeLinkTags, villagesOf, withVillageTags } from '@/lib/contentTags';
import { latestRSVPs } from '@/lib/rsvp';
import { useNostr } from '@nostrify/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useVillagePreferences } from './useVillagePreferences';
import { useCurrentUser } from './useCurrentUser';
import { useTribe } from './useTribes';
import { MAX_FEED_AUTHORS, tribeEventAuthors, tribeModerators } from '@/lib/tribes';
import { dropHidden } from '@/lib/moderation';

// Event types for multi-type support (whitelisted values)
export const EVENT_TYPES = [
  'meetup',
  'gathering',
  'potluck',
  'trivia',
  'game',
  'service-day',
  'cleanup',
  'workshop',
  'skill-swap',
  'celebration',
  'ritual',
  'market',
  'swap',
  'freebie-fair',
  'mixer',
  'matchmaking',
  'council',
  'tribe-meeting'
] as const;

export type EventType = typeof EVENT_TYPES[number];

// Event visibility levels
export type EventVisibility = 'public' | 'tribe-only' | 'private';

// Event filter options
export interface EventFilters {
  etypes?: EventType[];
  visibility?: EventVisibility[];
  dateFrom?: string;
  dateTo?: string;
  distance?: string;
  village?: string;
  search?: string;
  showPrivateInvited?: boolean;
  limit?: number;
  /** Village feeds: windows of promotion labels to read (see readVillageFeed). */
  promotionPages?: number;
}

// Hook to get events for a specific tribe
export function useTribeEvents(tribeId: string, filters: EventFilters = {}) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  // Feed authors come from the tribe's member list: refetch whenever that definition changes.
  const tribeQuery = useTribe(tribeId);
  const tribeVersion = tribeQuery.data?.id ?? null;

  const { search, ...queryFilters } = filters;
  return useQuery({
    queryKey: ['tribe-events', tribeId, tribeVersion, queryFilters, user?.pubkey],
    select: (events: NostrEvent[]) => applyEventFilters(events, { search }),
    staleTime: 60000, // Cache for 1 minute
    enabled: tribeQuery.isFetched,
    queryFn: async (c) => {
      const { signal } = c;

      // Parse tribe coordinates
      const [pubkey, dTag] = tribeId.split(':');
      if (!pubkey || !dTag) return [];

      // Events can be created by the owner, admins, moderators and event creators.
      const tribe = tribeQuery.data ?? null;
      const authors = tribe ? tribeEventAuthors(tribe).slice(0, MAX_FEED_AUTHORS) : [pubkey];

      const allowed = new Set(tribe ? tribeEventAuthors(tribe) : [pubkey]);
      const moderators = tribe ? tribeModerators(tribe) : [pubkey];
      const records = await dropHidden(nostr, await nostr.query([
        // Indexed: events tagged with the tribe coordinate (any size of tribe)
        { kinds: [36959, 31923], '#a': [tribeCoordinate(tribeId)], limit: (filters.limit || 100) + 100 },
        // Legacy: events from before the indexed tag, found through their authors
        { kinds: [36959], authors, limit: filters.limit || 100 },
        { kinds: [31923], authors, limit: 100 },
      ], { signal }), moderators, signal);
      let validEvents = records.filter(event =>
        allowed.has(event.pubkey) && belongsToTribe(event.tags, tribeId)
        && (event.kind === 36959 ? validateEnhancedEvent(event) : validateCalendarEvent(event)));

      validEvents = applyEventFilters(validEvents, queryFilters, user?.pubkey);

      // Sort by start time (upcoming events first)
      return validEvents.sort((a, b) => {
        const startA = parseInt(a.tags.find(([name]) => name === 'start')?.[1] || '0');
        const startB = parseInt(b.tags.find(([name]) => name === 'start')?.[1] || '0');
        return startA - startB;
      });
    },
  });
}

// Hook to get a specific event
export function useEvent(eventId: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['event', eventId],
    queryFn: async (c) => {
      const { signal } = c;

      // Parse event coordinates (format: pubkey:d-identifier)
      const [pubkey, dTag] = eventId.split(':');
      if (!pubkey || !dTag) {
        throw new Error('Invalid event ID format');
      }

      const events = await nostr.query([36959, 31923].map(kind => ({
        kinds: [kind], authors: [pubkey], '#d': [dTag], limit: 1,
      })), { signal });
      return events.find(validateEnhancedEvent) ?? events.find(validateCalendarEvent) ?? null;
    },
  });
}

// Hook to get RSVPs for an event
export function useEventRSVPs(eventId: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['event-rsvps', eventId],
    queryFn: async (c) => {
      const { signal } = c;

      const [pubkey, dTag] = eventId.split(':');
      if (!pubkey || !dTag) return [];

      // Query RSVPs for both enhanced (36959) and legacy (31923) event kinds
      // in a single request using multiple filters to avoid relay rate limiting
      const rsvps = await nostr.query(
        [
          {
            kinds: [31925], // Calendar Event RSVP (NIP-52)
            '#a': [
              `36959:${pubkey}:${dTag}`,
              `31923:${pubkey}:${dTag}`,
            ],
            limit: 200,
          },
        ],
        { signal },
      );

      return rsvps.filter(validateRSVPEvent);
    },

    retry: 2,
  });
}

// Hook to get attendance verifications for an event
export function useEventAttendance(eventId: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['event-attendance', eventId],
    queryFn: async (c) => {
      const { signal } = c;

      const [pubkey, dTag] = eventId.split(':');
      if (!pubkey || !dTag) return [];

      const events = await nostr.query([
        {
          kinds: [2073], // Custom attendance verification kind
          '#a': [`31923:${pubkey}:${dTag}`, `36959:${pubkey}:${dTag}`],
          limit: 200,
        }
      ], { signal });

      return events.filter(validateAttendanceEvent);
    },
  });
}

// Hook to get user's RSVP for a specific event
export function useUserRSVP(eventId: string, userPubkey?: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['user-rsvp', eventId, userPubkey],
    queryFn: async (c) => {
      if (!userPubkey) return null;

      const { signal } = c;

      const [pubkey, dTag] = eventId.split(':');
      if (!pubkey || !dTag) return null;

      // Query both enhanced (36959) and legacy (31923) event kinds in one request
      const events = await nostr.query(
        [
          {
            kinds: [31925],
            authors: [userPubkey],
            '#a': [
              `36959:${pubkey}:${dTag}`,
              `31923:${pubkey}:${dTag}`,
            ],
            limit: 5,
          },
        ],
        { signal },
      );

      // The user's own latest RSVP (they may have several d tags across clients)
      return latestRSVPs(events.filter(validateRSVPEvent))[0] ?? null;
    },
    enabled: !!userPubkey,
  });
}

// Hook to get events by village
export function useVillageEvents(villageSlugOrList: string | string[], filters: EventFilters = {}) {
  const { nostr } = useNostr();
  const { preferences } = useVillagePreferences();
  const { user } = useCurrentUser();

  const { search, ...queryFilters } = filters;
  const villages = villageList(villageSlugOrList);
  return useQuery({
    queryKey: ['village-events', villages, queryFilters, preferences.hiddenTribes, user?.pubkey],
    select: (events: NostrEvent[]) => applyEventFilters(events, { search }),
    staleTime: 30000, // Consider data fresh for 30 seconds
    queryFn: async (c) => {
      const { signal } = c;


      const { events: villageEvents } = await readVillageFeed(nostr, villages,
        [{ kinds: [36959], limit: filters.limit || 150 }, { kinds: [31923], limit: 50 }], signal, { promotionPages: filters.promotionPages });

      // Validate events
      const validEvents = villageEvents.filter(event =>
        event.kind === 36959 ? validateEnhancedEvent(event) : validateCalendarEvent(event)
      );

      let filteredEvents = applyEventFilters(validEvents, queryFilters, user?.pubkey);

      // Filter out events from hidden tribes
      filteredEvents = filteredEvents.filter(event => {
        const tribeTag = event.tags.find(([name]) => name === 'tribe')?.[1];
        return !tribeTag || !preferences.hiddenTribes.includes(tribeTag);
      });


      // Sort by start time (upcoming events first)
      return filteredEvents.sort((a, b) => {
        const startA = parseInt(a.tags.find(([name]) => name === 'start')?.[1] || '0');
        const startB = parseInt(b.tags.find(([name]) => name === 'start')?.[1] || '0');
        return startA - startB;
      });
    },
  });
}

// Hook to promote an event to villages (creates label AND updates event with village tags)
export function usePromoteEventToVillages() {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: {
      event: NostrEvent;
      villages: string[];
      reason?: string;
    }) => {
      const { event, villages, reason } = data;

      // Parse event data
      const dTag = event.tags.find(([name]) => name === 'd')?.[1];
      if (!dTag) {
        throw new Error('Event missing d tag');
      }

      const eventId = `${event.pubkey}:${dTag}`;

      // Get existing village tags
      const existingVillageTags = villagesOf(event.tags);
      const newVillages = villages.filter(v => !existingVillageTags.includes(v));
      const allVillages = [...existingVillageTags, ...newVillages];

      // Create updated event with village tags
      const updatedTags = withVillageTags(event.tags, allVillages);

      const updatedEvent = {
        kind: event.kind,
        content: event.content,
        tags: updatedTags,
        created_at: Math.floor(Date.now() / 1000),
      };

      // Create promotion label
      const labelTags: string[][] = [
        ['a', `${event.kind}:${event.pubkey}:${dTag}`],
        ['l', 'village-promoted', 'promotion'],
        ['L', 'promotion'],
        ['alt', `Event promoted to villages: ${villages.join(', ')}`],
      ];

      // Add village context to label
      // Legacy `village` tags plus indexed `t` village topics, so readers can find this
      // promotion by village (relays only index single-letter tags)
      labelTags.splice(0, labelTags.length, ...withVillageTags(labelTags, villages));

      const promotionLabel = {
        kind: 1985,
        content: reason || `Promoted to ${villages.join(', ')}`,
        tags: labelTags,
        created_at: Math.floor(Date.now() / 1000),
      };

      // Only the author can replace their own event; anyone else promoting it would
      // publish a copy under their own key. The label alone carries the promotion.
      const target = data.event;
      if (user?.pubkey === target.pubkey) await publish(updatedEvent);
      await publish(promotionLabel);
      return {
        eventId,
        updatedEvent,
        promotionLabel,
        villages: allVillages,
      };
    },
    onSuccess: (result) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({
        queryKey: ['event', result.eventId]
      });
      queryClient.invalidateQueries({
        queryKey: ['tribe-events']
      });
      queryClient.invalidateQueries({
        queryKey: ['village-events']
      });

      // Invalidate specific village queries
      result.villages.forEach(village => {
        queryClient.invalidateQueries({
          queryKey: ['village-events', village]
        });
      });
    },
  });
}

/**
 * Everything an enhanced event publishes. All of it is public on Nostr: `visibility` and the
 * invitee `p` tags are display and invitation hints for apps, not access control. Exact
 * addresses and confidential instructions are not accepted here; they only travel in the
 * encrypted invitation message (see `buildPrivateDetailsMessage`).
 */
export interface EnhancedEventInput {
  tribe: string;
  title: string;
  summary?: string;
  content: string;
  start: number;
  end?: number;
  place: string;
  lat?: number;
  lon?: number;
  image?: string; // Event image URL
  etypes: EventType[];
  visibility: EventVisibility;
  villages?: string[];
  invitees?: string[];
  typeSpecificData?: Record<string, string | string[]>;
  dTag?: string; // For updates
}

/** The unsigned kind 36959 event for `data` (pure; every field in it is public). */
export function buildEnhancedEventTemplate(data: EnhancedEventInput, now = Math.floor(Date.now() / 1000)) {
  // Generate a unique d tag if not provided (for updates)
  const dTag = data.dTag || `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Build tags array
  const tags: string[][] = [
    ['d', dTag],
    // Indexed tribe coordinate plus the legacy d-tag reference
    ...tribeLinkTags(data.tribe),
    ['title', data.title],
    ...(data.summary ? [['summary', data.summary]] : []),
    ['start', data.start.toString()],
    ['place', data.place],
    // Optional, coarse location (geohash cell of about 1 km)
    ...locationTags(data.lat, data.lon),
    ['visibility', data.visibility],
    ['alt', 'Community event for local participation'],
  ];

  // Add image tag if provided
  if (data.image) {
    tags.push(['image', data.image]);
  }

  // Add end time if provided
  if (data.end) {
    tags.push(['end', data.end.toString()]);
  }

  // Add event types
  data.etypes.forEach(etype => {
    tags.push(['etype', etype]);
  });

  // Add village tags (legacy + indexed)
  tags.splice(0, tags.length, ...withVillageTags(tags, data.villages ?? []));

  // Invitees of invite-only events (public: anyone can read who was invited)
  if (data.visibility === 'private' && data.invitees && data.invitees.length > 0) {
    data.invitees.forEach(invitee => {
      tags.push(['p', invitee]);
    });
  }

  // Add type-specific tags
  if (data.typeSpecificData) {
    Object.entries(data.typeSpecificData).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach(v => tags.push([key, v]));
      } else {
        tags.push([key, value]);
      }
    });
  }

  return { dTag, template: { kind: 36959, content: data.content, tags, created_at: now } };
}

// Hook to create or update an enhanced event
export function useCreateEnhancedEvent() {
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: EnhancedEventInput) => {
      const { dTag, template } = buildEnhancedEventTemplate(data);
      const published = await publish(template);
      return {
        ...data,
        dTag,
        eventData: published,
        eventId: `${published.pubkey}:${dTag}`,
      };
    },
  });
}

/**
 * The invitation sent to each invitee as an encrypted direct message. This is the only place
 * private details and an exact location go; the published event never contains them.
 */
export function buildPrivateDetailsMessage(data: {
  eventId: string;
  eventTitle: string;
  privateDetails: string;
  exactLocation?: string;
  organizer: string;
}): string {
  return `🔒 Private Event Details: ${data.eventTitle}

${data.privateDetails}

${data.exactLocation ? `📍 Exact Location: ${data.exactLocation}` : ''}

Event ID: ${data.eventId}
Organizer: ${data.organizer}

The organizer shared these details with you in an encrypted message. The event listing itself is public; please don't repost these details.`;
}

// Hook to send private event details via DM
export function useSendPrivateEventDetails() {
  const { mutateAsync: send } = useSendDirectMessage();
  return useMutation({
    mutationFn: async (data: {
      eventId: string;
      eventTitle: string;
      invitees: string[];
      privateDetails: string;
      exactLocation?: string;
      organizer: string;
    }) => {
      const dmContent = buildPrivateDetailsMessage(data);
      const sent = await Promise.allSettled([...new Set(data.invitees)].map(recipient =>
        send({ recipient, message: dmContent })
      ));
      return sent.filter(outcome => outcome.status === 'rejected').length;
    },
  });
}

// Hook to create an event label (for moderation)
export function useCreateEventLabel() {
  const queryClient = useQueryClient();
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: {
      eventId: string;
      eventKind: 36959 | 31923;
      label: string;
      /** Villages a promotion or feature label applies to. */
      villages?: string[];
      namespace?: string;
      content?: string;
    }) => {
      // Parse event coordinates
      const [pubkey, dTag] = data.eventId.split(':');
      if (!pubkey || !dTag) {
        throw new Error('Invalid event ID format');
      }

      // Build tags array
      const tags: string[][] = [
        ['a', `${data.eventKind}:${pubkey}:${dTag}`],
        ['l', data.label, data.namespace || 'ugc'],
        ['alt', `Event moderation label: ${data.label}`],
      ];

      // Legacy `village` tags plus indexed `t` village topics (see promotion discovery)
      if (data.villages?.length) tags.splice(0, tags.length, ...withVillageTags(tags, data.villages));

      // Add namespace tag if provided
      if (data.namespace) {
        tags.push(['L', data.namespace]);
      }

      // Create the event
      const eventData = {
        kind: 1985,
        content: data.content || '',
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };

      await publish(eventData);
      return { ...data, eventData };
    },
    onSuccess: (_, variables) => {
      // Invalidate labels for this event
      queryClient.invalidateQueries({
        queryKey: ['event-labels', variables.eventId]
      });

      // If this is a village promotion, invalidate village events
      if (variables.label === 'village-promoted') {
        queryClient.invalidateQueries({
          queryKey: ['village-events']
        });
      }
    },
  });
}

// Validate calendar event structure
export function validateCalendarEvent(event: NostrEvent): boolean {
  if (event.kind !== 31923) return false;

  const dTag = event.tags.find(([name]) => name === 'd')?.[1];
  const titleTag = event.tags.find(([name]) => name === 'title')?.[1];
  const startTag = event.tags.find(([name]) => name === 'start')?.[1];

  if (!dTag || !titleTag || !startTag) return false;

  // Validate start timestamp
  const timestamp = parseInt(startTag);
  if (isNaN(timestamp) || timestamp <= 0) return false;

  return true;
}

// Validate RSVP event structure
export function validateRSVPEvent(event: NostrEvent): boolean {
  if (event.kind !== 31925) return false;

  const dTag = event.tags.find(([name]) => name === 'd')?.[1];
  const aTag = event.tags.find(([name]) => name === 'a')?.[1];
  const statusTag = event.tags.find(([name]) => name === 'status')?.[1];

  if (!dTag || !aTag || !statusTag) return false;
  if (!['accepted', 'declined', 'tentative'].includes(statusTag)) return false;

  return true;
}

// Validate enhanced event structure
export function validateEnhancedEvent(event: NostrEvent): boolean {
  if (event.kind !== 36959) {
    return false;
  }

  const dTag = event.tags.find(([name]) => name === 'd')?.[1];
  const tribeTag = event.tags.find(([name]) => name === 'tribe')?.[1];
  const titleTag = event.tags.find(([name]) => name === 'title')?.[1];
  const startTag = event.tags.find(([name]) => name === 'start')?.[1];
  const placeTag = event.tags.find(([name]) => name === 'place')?.[1];

  // Required tags (coordinates are optional)
  if (!dTag || !tribeTag || !titleTag || !startTag || !placeTag) {
    return false;
  }

  // Validate start timestamp
  const timestamp = parseInt(startTag);
  if (isNaN(timestamp) || timestamp <= 0) {
    return false;
  }


  // Validate event types (OPTIONAL for backward compatibility with old events)
  const etypeTags = event.tags.filter(([name]) => name === 'etype');
  if (etypeTags.length > 0) {
    // If event has etype tags, validate them
    for (const [, etype] of etypeTags) {
      if (!EVENT_TYPES.includes(etype as EventType)) return false;
    }
  }
  // If no etype tags, event is still valid (backward compatibility)

  // Validate visibility
  const visibilityTag = event.tags.find(([name]) => name === 'visibility')?.[1];
  if (visibilityTag && !['public', 'tribe-only', 'private'].includes(visibilityTag)) return false;

  // Validate content length (increased to 2000 for detailed descriptions)
  if (event.content.length > 2000) {
    return false;
  }


  return true;
}

// Validate attendance event structure
export function validateAttendanceEvent(event: NostrEvent): boolean {
  if (event.kind !== 2073) return false;

  const aTag = event.tags.find(([name]) => name === 'a')?.[1];
  const nonceTag = event.tags.find(([name]) => name === 'nonce')?.[1];
  const verifiedAtTag = event.tags.find(([name]) => name === 'verified_at')?.[1];

  if (!aTag || !nonceTag || !verifiedAtTag) return false;

  return true;
}

// Apply event filters
export function applyEventFilters(
  events: NostrEvent[],
  filters: EventFilters,
  userPubkey?: string
): NostrEvent[] {
  let filteredEvents = events;

  // Filter by event types
  if (filters.etypes && filters.etypes.length > 0) {
    filteredEvents = filteredEvents.filter(event => {
      const eventTypes = event.tags.filter(([name]) => name === 'etype').map(([, value]) => value);
      return filters.etypes!.some(filterType => eventTypes.includes(filterType));
    });
  }

  // Filter by visibility
  if (filters.visibility && filters.visibility.length > 0) {
    filteredEvents = filteredEvents.filter(event => {
      const visibility = event.tags.find(([name]) => name === 'visibility')?.[1] || 'public';

      // Handle private events - only show if user is organizer or invitee
      if (visibility === 'private') {
        if (!userPubkey) return false;

        const isOrganizer = event.pubkey === userPubkey;
        const isInvited = event.tags.some(([name, value]) => name === 'p' && value === userPubkey);

        return (isOrganizer || isInvited) && filters.showPrivateInvited;
      }

      return filters.visibility!.includes(visibility as EventVisibility);
    });
  }

  // Filter by date range
  if (filters.dateFrom || filters.dateTo) {
    filteredEvents = filteredEvents.filter(event => {
      const startTime = parseInt(event.tags.find(([name]) => name === 'start')?.[1] || '0');

      if (filters.dateFrom) {
        const fromTime = new Date(filters.dateFrom).getTime() / 1000;
        if (startTime < fromTime) return false;
      }

      if (filters.dateTo) {
        const toTime = new Date(filters.dateTo).getTime() / 1000;
        if (startTime > toTime) return false;
      }

      return true;
    });
  }

  // Filter by search term
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filteredEvents = filteredEvents.filter(event => {
      const title = event.tags.find(([name]) => name === 'title')?.[1] || '';
      const summary = event.tags.find(([name]) => name === 'summary')?.[1] || '';
      const place = event.tags.find(([name]) => name === 'place')?.[1] || '';
      const eventTypes = event.tags.filter(([name]) => name === 'etype').map(([, value]) => value).join(' ');

      return title.toLowerCase().includes(searchLower) ||
             summary.toLowerCase().includes(searchLower) ||
             place.toLowerCase().includes(searchLower) ||
             eventTypes.toLowerCase().includes(searchLower) ||
             event.content.toLowerCase().includes(searchLower);
    });
  }

  return filteredEvents;
}

// Helper function to get event type display info
export function getEventTypeInfo(etype: EventType) {
  const typeInfo = {
    meetup: { emoji: '👥', label: 'Meetup' },
    gathering: { emoji: '👥', label: 'Gathering' },
    potluck: { emoji: '🍲', label: 'Potluck' },
    trivia: { emoji: '🧠', label: 'Trivia' },
    game: { emoji: '🎮', label: 'Game' },
    'service-day': { emoji: '🧹', label: 'Service Day' },
    cleanup: { emoji: '🧹', label: 'Cleanup' },
    workshop: { emoji: '🛠️', label: 'Workshop' },
    'skill-swap': { emoji: '🤝', label: 'Skill Swap' },
    celebration: { emoji: '🎉', label: 'Celebration' },
    ritual: { emoji: '🕯️', label: 'Ritual' },
    market: { emoji: '🛒', label: 'Market' },
    swap: { emoji: '🔄', label: 'Swap' },
    'freebie-fair': { emoji: '🎁', label: 'Freebie Fair' },
    mixer: { emoji: '💫', label: 'Mixer' },
    matchmaking: { emoji: '💕', label: 'Matchmaking' },
    council: { emoji: '🏛️', label: 'Council' },
    'tribe-meeting': { emoji: '🏛️', label: 'Tribe Meeting' },
  };

  return typeInfo[etype] || { emoji: '📅', label: etype };
}