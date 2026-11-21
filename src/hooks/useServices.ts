import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { readVillageFeed } from '@/lib/villageFeed';
import { distanceMiles, locationTags, nearestDistanceMiles, readLocation, type LatLon } from '@/lib/location';
import { villageList } from '@/lib/villages';
import { belongsToTribe, tribeCoordinate, tribeLinkTags, villagesOf, withVillageTags } from '@/lib/contentTags';
import { useNostr } from '@nostrify/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent, NStore } from '@nostrify/nostrify';
import { batcherPerStore, createBatcher } from '@/lib/batcher';
import { useVillagePreferences } from './useVillagePreferences';
import { useTribe } from './useTribes';
import { MAX_FEED_AUTHORS, tribeMemberAuthors, tribeModerators } from '@/lib/tribes';
import { dropHidden } from '@/lib/moderation';

// Service categories
export const SERVICE_CATEGORIES = [
  'yardwork',
  'pets',
  'eldercare',
  'errands',
  'oddjobs'
] as const;

export type ServiceCategory = typeof SERVICE_CATEGORIES[number];

// Service types
export type ServiceType = 'offer' | 'request';

// Service filter options
export interface ServiceFilters {
  type?: ServiceType;
  category?: ServiceCategory;
  distance?: string; // '3blocks' | '0.5mi' | '1mi'
  when?: string; // 'mornings' | 'afternoons' | 'evenings' | 'weekends'
  trusted?: boolean;
  village?: string;
  search?: string;
  limit?: number;
}

// Hook to get services for a specific tribe
export function useTribeServices(tribeId: string, filters: ServiceFilters = {}) {
  const { nostr } = useNostr();
  // Feed authors come from the tribe's member list: refetch whenever that definition changes.
  const tribeQuery = useTribe(tribeId);
  const tribeVersion = tribeQuery.data?.id ?? null;

  const { search, ...queryFilters } = filters;
  return useQuery({
    queryKey: ['tribe-services', tribeId, tribeVersion, queryFilters],
    select: (events: NostrEvent[]) => search ? events.filter(event => event.content.toLowerCase().includes(search.toLowerCase())) : events,
    staleTime: 30000, // Consider data fresh for 30 seconds
    enabled: tribeQuery.isFetched,
    queryFn: async (c) => {
      const { signal } = c;

      // Parse tribe coordinates
      const [pubkey, dTag] = tribeId.split(':');
      if (!pubkey || !dTag) return [];

      // Build filter for both offers and requests
      const kinds: number[] = [];
      if (!filters.type || filters.type === 'offer') kinds.push(38857);
      if (!filters.type || filters.type === 'request') kinds.push(30627);

      // Any member can offer or request services in their tribe.
      const tribe = tribeQuery.data ?? null;
      const authors = tribe ? tribeMemberAuthors(tribe).slice(0, MAX_FEED_AUTHORS) : [pubkey];
      const moderators = tribe ? tribeModerators(tribe) : [pubkey];
      const allowed = new Set(tribe ? tribeMemberAuthors(tribe) : [pubkey]);
      const records = await dropHidden(nostr, await nostr.query([
        // Indexed: services tagged with the tribe coordinate
        { kinds, '#a': [tribeCoordinate(tribeId)], limit: 200 },
        // Legacy: services from before the indexed tag, found through their authors
        { kinds, authors, limit: 200 },
      ], { signal }), moderators, signal);
      const tribeEvents = records.filter(event =>
        allowed.has(event.pubkey) && belongsToTribe(event.tags, tribeId));

      // Apply additional filters
      let filteredEvents = tribeEvents;

      if (filters.category) {
        filteredEvents = filteredEvents.filter(event => {
          return event.tags.some(([name, value]) => name === 't' && value === filters.category);
        });
      }

      if (filters.village) {
        filteredEvents = filteredEvents.filter(event => {
          return event.tags.some(([name, value]) => name === 'village' && value === filters.village);
        });
      }


      const validEvents = filteredEvents.filter(validateServiceEvent);

      return validEvents;
    },
  });
}

// Hook to get services by village
export function useVillageServices(villageSlugOrList: string | string[], filters: ServiceFilters = {}) {
  const { nostr } = useNostr();
  const { preferences } = useVillagePreferences();

  const { search, ...queryFilters } = filters;
  const villages = villageList(villageSlugOrList);
  return useQuery({
    queryKey: ['village-services', villages, queryFilters, preferences.hiddenTribes],
    select: (events: NostrEvent[]) => search ? events.filter(event => event.content.toLowerCase().includes(search.toLowerCase())) : events,
    staleTime: 30000, // Consider data fresh for 30 seconds
    queryFn: async (c) => {
      const { signal } = c;

      // Build filter for both offers and requests
      const kinds: number[] = [];
      if (!filters.type || filters.type === 'offer') kinds.push(38857);
      if (!filters.type || filters.type === 'request') kinds.push(30627);


      const { events: villageEvents } = await readVillageFeed(nostr, villages,
        [{ kinds, limit: filters.limit || 200 }], signal);

      // Apply additional filters
      let filteredEvents = villageEvents;

      if (filters.category) {
        filteredEvents = filteredEvents.filter(event => {
          return event.tags.some(([name, value]) => name === 't' && value === filters.category);
        });
      }


      const validEvents = filteredEvents.filter(validateServiceEvent);

      // Filter out services from hidden tribes
      const nonHiddenEvents = validEvents.filter(event => {
        const tribeTag = event.tags.find(([name]) => name === 'tribe')?.[1];
        return !tribeTag || !preferences.hiddenTribes.includes(tribeTag);
      });


      // Sort by creation date (newest first)
      return nonHiddenEvents.sort((a, b) => b.created_at - a.created_at);
    },
  });
}

// Hook to create or update a service
export function useCreateService() {
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: {
      type: ServiceType;
      tribe: string;
      category: ServiceCategory;
      content: string;
      lat?: number;
      lon?: number;
      area?: string;
      avail?: string;
      time?: string;
      rate?: string;
      radius?: string;
      villages?: string[];
      expires?: number;
      dTag?: string; // For updates
    }) => {
      // Generate a unique d tag if not provided (for updates)
      const dTag = data.dTag || `${data.type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Determine the kind based on service type
      const kind = data.type === 'offer' ? 38857 : 30627;

      // Build tags array
      const tags: string[][] = [
        ['d', dTag],
        // Indexed tribe coordinate plus the legacy d-tag reference
        ...tribeLinkTags(data.tribe),
        ['t', data.category],
        // Optional, coarse location (geohash cell of about 1 km)
        ...locationTags(data.lat, data.lon),
        ['alt', `Service ${data.type} for local community help`],
      ];

      // Add optional tags
      if (data.area) tags.push(['area', data.area]);
      if (data.avail) tags.push(['avail', data.avail]);
      if (data.time) tags.push(['time', data.time]);
      if (data.rate) tags.push(['rate', data.rate]);
      if (data.radius) tags.push(['radius', data.radius]);
      // NIP-40: relays that support it drop the event after this time
      if (data.expires) tags.push(['expiration', data.expires.toString()]);

      // Add village tags (legacy + indexed)
      tags.splice(0, tags.length, ...withVillageTags(tags, data.villages ?? []));

      // Create the event
      const eventData = {
        kind,
        content: data.content,
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };

      await publish(eventData);
      return { ...data, dTag, kind, eventData };
    },
  });
}

// Hook to promote a service to villages (creates label AND updates service with village tags)
export function usePromoteServiceToVillages() {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: {
      service: NostrEvent;
      villages: string[];
      reason?: string;
    }) => {
      const { service, villages, reason } = data;

      // Parse service data
      const dTag = service.tags.find(([name]) => name === 'd')?.[1];
      if (!dTag) {
        throw new Error('Service missing d tag');
      }

      const serviceId = `${service.pubkey}:${dTag}`;

      // Get existing village tags
      const existingVillageTags = villagesOf(service.tags);
      const newVillages = villages.filter(v => !existingVillageTags.includes(v));
      const allVillages = [...existingVillageTags, ...newVillages];

      // Create updated service with village tags
      const updatedTags = withVillageTags(service.tags, allVillages);

      const updatedService = {
        kind: service.kind,
        content: service.content,
        tags: updatedTags,
        created_at: Math.floor(Date.now() / 1000),
      };

      // Create promotion label
      const labelTags: string[][] = [
        ['a', `${service.kind}:${service.pubkey}:${dTag}`],
        ['l', 'village-promoted', 'promotion'],
        ['L', 'promotion'],
        ['alt', `Service promoted to villages: ${villages.join(', ')}`],
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
      const target = data.service;
      if (user?.pubkey === target.pubkey) await publish(updatedService);
      await publish(promotionLabel);
      return {
        serviceId,
        updatedService,
        promotionLabel,
        villages: allVillages,
      };
    },
    onSuccess: (result) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({
        queryKey: ['service', result.serviceId]
      });
      queryClient.invalidateQueries({
        queryKey: ['tribe-services']
      });
      queryClient.invalidateQueries({
        queryKey: ['village-services']
      });

      // Invalidate specific village queries
      result.villages.forEach(village => {
        queryClient.invalidateQueries({
          queryKey: ['village-services', village]
        });
      });
    },
  });
}

// Hook to create a service label (for moderation)
export function useCreateServiceLabel() {
  const queryClient = useQueryClient();
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: {
      serviceId: string;
      serviceKind: 38857 | 30627;
      label: string;
      /** Villages a promotion or feature label applies to. */
      villages?: string[];
      namespace?: string;
      content?: string;
    }) => {
      // Parse service coordinates
      const [pubkey, dTag] = data.serviceId.split(':');
      if (!pubkey || !dTag) {
        throw new Error('Invalid service ID format');
      }

      // Build tags array
      const tags: string[][] = [
        ['a', `${data.serviceKind}:${pubkey}:${dTag}`],
        ['l', data.label, data.namespace || 'ugc'],
        ['alt', `Service moderation label: ${data.label}`],
      ];

      data.villages?.forEach(village => tags.push(['village', village]));

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
      // Invalidate labels for this service
      queryClient.invalidateQueries({
        queryKey: ['service-labels', variables.serviceId]
      });

      // If this is a village promotion, invalidate village services
      if (variables.label === 'village-promoted') {
        queryClient.invalidateQueries({
          queryKey: ['village-services']
        });
      }
    },
  });
}

/** Response lookups for many service cards are merged into one request. */
const responseLoader = batcherPerStore((nostr: NStore) => createBatcher<string, NostrEvent[]>(async (coordinates) => {
  const wanted = new Set(coordinates);
  const matches = (await nostr.query([{ kinds: [34871], '#a': coordinates, limit: coordinates.length * 50 }]))
    .filter(validateServiceMatchEvent);
  const byService = new Map<string, NostrEvent[]>(coordinates.map(coordinate => [coordinate, []]));
  for (const match of matches) {
    for (const [name, address] of match.tags) {
      if (name === 'a' && wanted.has(address)) byService.get(address)?.push(match);
    }
  }
  return byService;
}));

/** Responses (kind 34871 matches) to a service, one per responder (latest). */
export function useServiceMatches(service: NostrEvent | undefined, enabled = true) {
  const { nostr } = useNostr();
  const dTag = service?.tags.find(([name]) => name === 'd')?.[1];
  const coordinate = service && dTag ? `${service.kind}:${service.pubkey}:${dTag}` : '';
  return useQuery({
    queryKey: ['service-matches', coordinate.split(':').slice(1).join(':')],
    enabled: enabled && !!coordinate,
    queryFn: async () => {
      const matches = (await responseLoader(nostr)(coordinate)) ?? [];
      const latest = new Map<string, NostrEvent>();
      for (const match of matches) {
        const current = latest.get(match.pubkey);
        if (!current || match.created_at > current.created_at) latest.set(match.pubkey, match);
      }
      return [...latest.values()].sort((a, b) => b.created_at - a.created_at);
    },
  });
}

// Hook to create a service match
export function useCreateServiceMatch() {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: {
      requestARef?: string;
      offerARef?: string;
      type: 'offer_to_request' | 'request_to_offer' | 'admin_suggestion';
      message?: string;
    }) => {
      if (!user) throw new Error('User is not logged in');
      const refs = [data.requestARef, data.offerARef].filter((ref): ref is string => !!ref);
      // One match per person per service pairing: responding twice replaces the first.
      const dTag = `match-${refs.slice().sort().join('|')}-${user.pubkey}`;

      // Build tags array
      const tags: string[][] = [
        ['d', dTag],
        ['type', data.type],
        ['by', user.pubkey],
        ['alt', 'Service match connecting community members'],
      ];

      // Add service references, and notify their authors
      refs.forEach(ref => tags.push(['a', ref]));
      [...new Set(refs.map(ref => ref.split(':')[1]).filter(pubkey => pubkey && pubkey !== user.pubkey))]
        .forEach(pubkey => tags.push(['p', pubkey]));

      // Create the event
      const eventData = {
        kind: 34871,
        content: data.message || '',
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };

      await publish(eventData);
      return { ...data, dTag, eventData };
    },
    onSuccess: (_, variables) => {
      // Invalidate matches for related services
      if (variables.requestARef) {
        const serviceId = variables.requestARef.split(':').slice(1).join(':');
        queryClient.invalidateQueries({
          queryKey: ['service-matches', serviceId]
        });
      }
      if (variables.offerARef) {
        const serviceId = variables.offerARef.split(':').slice(1).join(':');
        queryClient.invalidateQueries({
          queryKey: ['service-matches', serviceId]
        });
      }
    },
  });
}

// Validate service event structure
export function validateServiceEvent(event: NostrEvent): boolean {
  if (![38857, 30627].includes(event.kind)) return false;

  const dTag = event.tags.find(([name]) => name === 'd')?.[1];
  const tribeTag = event.tags.find(([name]) => name === 'tribe')?.[1];
  const categoryTag = event.tags.find(([name]) => name === 't')?.[1];

  // Required tags (location is optional)
  if (!dTag || !tribeTag || !categoryTag) return false;

  // Location is optional, but a legacy coordinate tag (two elements, unlike NIP-32
  // labels which carry a namespace) must parse as "lat,lon"
  const legacyLocation = event.tags.find(tag => tag[0] === 'l' && tag.length === 2)?.[1];
  if (legacyLocation !== undefined && !readLocation([['l', legacyLocation]])) return false;

  // Expired services (NIP-40 `expiration`, or the legacy `expires` tag) are no longer shown
  const expiresAt = Number(event.tags.find(([name]) => name === 'expiration' || name === 'expires')?.[1]);
  if (expiresAt && expiresAt * 1000 < Date.now()) return false;

  // Validate category
  if (!SERVICE_CATEGORIES.includes(categoryTag as ServiceCategory)) return false;

  // Validate content length
  if (event.content.length > 140) return false;

  return true;
}

// Validate service match event structure
export function validateServiceMatchEvent(event: NostrEvent): boolean {
  if (event.kind !== 34871) return false;

  const dTag = event.tags.find(([name]) => name === 'd')?.[1];
  const byTag = event.tags.find(([name]) => name === 'by')?.[1];
  const typeTag = event.tags.find(([name]) => name === 'type')?.[1];
  const aTags = event.tags.filter(([name]) => name === 'a');

  if (!dTag || !byTag || !typeTag) return false;
  if (!['offer_to_request', 'request_to_offer', 'admin_suggestion'].includes(typeTag)) return false;
  if (aTags.length === 0) return false;

  return true;
}

// Helper function to extract service data from event
export function extractServiceData(event: NostrEvent) {
  const tags = event.tags;
  const getTag = (name: string) => tags.find(([n]) => n === name)?.[1];
  const getAllTags = (name: string) => tags.filter(([n]) => n === name).map(([, value]) => value);

  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind as 38857 | 30627,
    content: event.content,
    createdAt: event.created_at,
    dTag: getTag('d'),
    tribe: getTag('tribe'),
    villages: getAllTags('village'),
    category: getTag('t') as ServiceCategory,
    location: getTag('l'),
    area: getTag('area'),
    availability: getTag('avail'),
    timeWindow: getTag('time'),
    rate: getTag('rate'),
    radius: getTag('radius'),
    contact: getTag('contact'),
    expires: (getTag('expiration') ?? getTag('expires')) ? parseInt((getTag('expiration') ?? getTag('expires'))!) : undefined,
  };
}

/** Great-circle distance in miles. */
export const calculateDistance = distanceMiles;

/** The radius a service distance filter allows, in miles; undefined for "any distance". */
export function distanceFilterMiles(distance?: string): number | undefined {
  if (!distance) return undefined;
  return distance === '3blocks' ? 0.1 : distance === '0.5mi' ? 0.5 : 1;
}

/**
 * Services that could be within the filter's radius of the reader. A service's published
 * location is approximate (a geohash cell), so it matches when any part of its cell is in
 * range. Without a distance filter or a reader location, every service is returned.
 */
export function filterByDistance<T extends { tags: string[][] }>(services: T[], distance: string | undefined, from: LatLon | undefined): T[] {
  const maxMiles = distanceFilterMiles(distance);
  if (maxMiles === undefined || !from) return services;
  return services.filter(service => {
    const miles = nearestDistanceMiles(from, service.tags);
    return miles !== undefined && miles <= maxMiles;
  });
}

// Helper function to format distance
export function formatDistance(miles: number): string {
  if (miles < 0.1) return '~1 block';
  if (miles < 0.25) return '~3 blocks';
  if (miles < 0.5) return '~½ mile';
  if (miles < 1) return '~¾ mile';
  const rounded = Math.round(miles);
  return `~${rounded} mile${rounded === 1 ? '' : 's'}`;
}