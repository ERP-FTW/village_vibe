import { useSendDirectMessage } from './useSendDirectMessage';
import { useNostrPublish } from './useNostrPublish';
import { readVillageFeed } from '@/lib/villageFeed';
import { useNostr } from '@nostrify/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useVillagePreferences } from './useVillagePreferences';
import { useCurrentUser } from './useCurrentUser';
import { useTribe } from './useTribes';
import { MAX_FEED_AUTHORS, tribeEventAuthors } from '@/lib/tribes';

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
    retry: 3, // Retry 3 times on failure
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
    enabled: tribeQuery.isFetched,
    queryFn: async (c) => {
      const { signal } = c;

      // Parse tribe coordinates
      const [pubkey, dTag] = tribeId.split(':');
      if (!pubkey || !dTag) return [];

      // Events can be created by the owner, admins, moderators and event creators.
      const tribe = tribeQuery.data ?? null;
      const authors = tribe ? tribeEventAuthors(tribe).slice(0, MAX_FEED_AUTHORS) : [pubkey];

      const records = await nostr.query([
        { kinds: [36959], authors, limit: filters.limit || 100 },
        { kinds: [31923], authors, limit: 100 },
      ], { signal });
      let validEvents = records.filter(event => event.tags.some(([name, value]) =>
        (name === 'tribe' && (value === dTag || value === tribeId)) ||
        (event.kind === 31923 && name === 'a' && value === `34550:${tribeId}`)
      ) && (event.kind === 36959 ? validateEnhancedEvent(event) : validateCalendarEvent(event)));

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

      const rsvp = events.find(validateRSVPEvent);
      return rsvp ?? null;
    },
    enabled: !!userPubkey,
  });
}

// Hook to get events by village
export function useVillageEvents(villageSlug: string, filters: EventFilters = {}) {
  const { nostr } = useNostr();
  const { preferences } = useVillagePreferences();
  const { user } = useCurrentUser();

  const { search, ...queryFilters } = filters;
  return useQuery({
    queryKey: ['village-events', villageSlug, queryFilters, preferences.hiddenTribes, user?.pubkey],
    select: (events: NostrEvent[]) => applyEventFilters(events, { search }),
    staleTime: 30000, // Consider data fresh for 30 seconds
    queryFn: async (c) => {
      const { signal } = c;

      console.log('🏘️ Querying village events for:', villageSlug);

      const villageEvents = await readVillageFeed(nostr, villageSlug === 'main' ? [] : [villageSlug],
        [{ kinds: [36959], limit: filters.limit || 150 }, { kinds: [31923], limit: 50 }], signal);

      // Validate events
      const validEvents = villageEvents.filter(event =>
        event.kind === 36959 ? validateEnhancedEvent(event) : validateCalendarEvent(event)
      );
      console.log('✅ Valid village events after all strategies:', validEvents.length);

      let filteredEvents = applyEventFilters(validEvents, queryFilters, user?.pubkey);

      // Filter out events from hidden tribes
      filteredEvents = filteredEvents.filter(event => {
        const tribeTag = event.tags.find(([name]) => name === 'tribe')?.[1];
        return !tribeTag || !preferences.hiddenTribes.includes(tribeTag);
      });

      console.log('🚫 After filtering hidden tribes:', filteredEvents.length);

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
      const existingVillageTags = event.tags.filter(([name]) => name === 'village').map(([, value]) => value);
      const newVillages = villages.filter(v => !existingVillageTags.includes(v));
      const allVillages = [...existingVillageTags, ...newVillages];

      // Create updated event with village tags
      const updatedTags = [
        ...event.tags.filter(([name]) => name !== 'village'), // Remove existing village tags
        ...allVillages.map(village => ['village', village]), // Add all village tags
      ];

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
      villages.forEach(village => {
        labelTags.push(['village', village]);
      });

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

// Hook to create or update an enhanced event
export function useCreateEnhancedEvent() {
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: {
      tribe: string;
      title: string;
      content: string;
      start: number;
      end?: number;
      place: string;
      lat: number;
      lon: number;
      image?: string; // Event image URL
      etypes: EventType[];
      visibility: EventVisibility;
      villages?: string[];
      invitees?: string[];
      privateDetails?: string;
      typeSpecificData?: Record<string, string | string[]>;
      dTag?: string; // For updates
    }) => {
      // Generate a unique d tag if not provided (for updates)
      const dTag = data.dTag || `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Parse tribeId to determine tribe tag format
      // If tribe is in format "pubkey:dTag", use dTag part for tribe tag
      // If tribe is just dTag, use it as-is
      const tribeTagValue = data.tribe.includes(':') ? data.tribe.split(':')[1] : data.tribe;

      // Build tags array
      const tags: string[][] = [
        ['d', dTag],
        ['tribe', tribeTagValue], // Use dTag part for tribe tag
        ['title', data.title],
        ['start', data.start.toString()],
        ['place', data.place],
        ['l', `${data.lat.toFixed(4)},${data.lon.toFixed(4)}`], // Round for privacy
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

      // Add village tags
      if (data.villages && data.villages.length > 0) {
        data.villages.forEach(village => {
          tags.push(['village', village]);
        });
      }

      // Add invitees for private events
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

      // Create the event
      const eventData = {
        kind: 36959,
        content: data.content,
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };

      const published = await publish(eventData);
      return {
        ...data,
        dTag,
        eventData: published,
        eventId: `${published.pubkey}:${dTag}`,
      };
    },
  });
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
      const dmContent = `🔒 Private Event Details: ${data.eventTitle}

${data.privateDetails}

${data.exactLocation ? `📍 Exact Location: ${data.exactLocation}` : ''}

Event ID: ${data.eventId}
Organizer: ${data.organizer}

This is a private event. Please don't share these details publicly.`;

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
    console.log('❌ Validation failed: wrong kind', event.kind);
    return false;
  }

  const dTag = event.tags.find(([name]) => name === 'd')?.[1];
  const tribeTag = event.tags.find(([name]) => name === 'tribe')?.[1];
  const titleTag = event.tags.find(([name]) => name === 'title')?.[1];
  const startTag = event.tags.find(([name]) => name === 'start')?.[1];
  const placeTag = event.tags.find(([name]) => name === 'place')?.[1];
  const locationTag = event.tags.find(([name]) => name === 'l')?.[1];

  // Required tags
  if (!dTag || !tribeTag || !titleTag || !startTag || !placeTag || !locationTag) {
    console.log('❌ Validation failed: missing required tags', {
      eventId: event.id.slice(0, 8),
      title: titleTag,
      hasDTag: !!dTag,
      hasTribe: !!tribeTag,
      hasTitle: !!titleTag,
      hasStart: !!startTag,
      hasPlace: !!placeTag,
      hasLocation: !!locationTag,
    });
    return false;
  }

  // Validate start timestamp
  const timestamp = parseInt(startTag);
  if (isNaN(timestamp) || timestamp <= 0) {
    console.log('❌ Validation failed: invalid timestamp', {
      eventId: event.id.slice(0, 8),
      title: titleTag,
      startTag,
      timestamp,
    });
    return false;
  }

  // Validate location format (lat,lon)
  const locationParts = locationTag.split(',');
  if (locationParts.length !== 2) {
    console.log('❌ Validation failed: invalid location format', {
      eventId: event.id.slice(0, 8),
      title: titleTag,
      locationTag,
      parts: locationParts.length,
    });
    return false;
  }

  const [lat, lon] = locationParts.map(Number);
  if (isNaN(lat) || isNaN(lon)) {
    console.log('❌ Validation failed: location not numbers', {
      eventId: event.id.slice(0, 8),
      title: titleTag,
      lat,
      lon,
    });
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
    console.log('❌ Validation failed: content too long', {
      eventId: event.id.slice(0, 8),
      title: titleTag,
      contentLength: event.content.length,
    });
    return false;
  }

  console.log('✅ Validation passed:', {
    eventId: event.id.slice(0, 8),
    title: titleTag,
  });

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

// Helper function to extract enhanced event data
export function extractEnhancedEventData(event: NostrEvent) {
  const tags = event.tags;
  const getTag = (name: string) => tags.find(([n]) => n === name)?.[1];
  const getAllTags = (name: string) => tags.filter(([n]) => n === name).map(([, value]) => value);

  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    content: event.content,
    createdAt: event.created_at,
    dTag: getTag('d'),
    tribe: getTag('tribe'),
    title: getTag('title'),
    start: getTag('start') ? parseInt(getTag('start')!) : undefined,
    end: getTag('end') ? parseInt(getTag('end')!) : undefined,
    place: getTag('place'),
    location: getTag('l'),
    visibility: getTag('visibility') as EventVisibility || 'public',
    villages: getAllTags('village'),
    etypes: getAllTags('etype') as EventType[],
    invitees: getAllTags('p'),
    summary: getTag('summary'),

    // Type-specific data
    foodSlots: getAllTags('food'),
    dietNotes: getTag('diet_notes'),
    tasks: getAllTags('task'),
    toolsNeeded: getTag('tools_needed'),
    instructors: getAllTags('instructors'),
    materials: getTag('materials'),
    gameKind: getTag('game_kind'),
    teamsMode: getTag('teams_mode'),
    occasion: getTag('occasion'),
  };
}

// Helper function to check if user can see private event
export function canUserSeePrivateEvent(event: NostrEvent, userPubkey?: string): boolean {
  const visibility = event.tags.find(([name]) => name === 'visibility')?.[1] || 'public';

  if (visibility !== 'private') return true;
  if (!userPubkey) return false;

  const isOrganizer = event.pubkey === userPubkey;
  const isInvited = event.tags.some(([name, value]) => name === 'p' && value === userPubkey);

  return isOrganizer || isInvited;
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