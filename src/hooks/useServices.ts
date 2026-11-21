import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { readVillageFeed } from '@/lib/villageFeed';
import { belongsToTribe, tribeCoordinate, tribeLinkTags, villagesOf, withVillageTags } from '@/lib/contentTags';
import { useNostr } from '@nostrify/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useVillagePreferences } from './useVillagePreferences';
import { tribeQueryOptions } from './useTribes';
import { MAX_FEED_AUTHORS, tribeMemberAuthors, tribeModerators } from '@/lib/tribes';
import { tribeHiddenLabelsFilter, withoutHidden } from '@/lib/moderation';

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
  const queryClient = useQueryClient();

  const { search, ...queryFilters } = filters;
  return useQuery({
    queryKey: ['tribe-services', tribeId, queryFilters],
    select: (events: NostrEvent[]) => search ? events.filter(event => event.content.toLowerCase().includes(search.toLowerCase())) : events,
    staleTime: 30000, // Consider data fresh for 30 seconds
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
      const tribe = await queryClient.ensureQueryData(tribeQueryOptions(nostr, tribeId));
      const authors = tribe ? tribeMemberAuthors(tribe).slice(0, MAX_FEED_AUTHORS) : [pubkey];
      const moderators = tribe ? tribeModerators(tribe) : [pubkey];
      const allowed = new Set(tribe ? tribeMemberAuthors(tribe) : [pubkey]);
      const records = withoutHidden(await nostr.query([
        // Indexed: services tagged with the tribe coordinate
        { kinds, '#a': [tribeCoordinate(tribeId)], limit: 200 },
        // Legacy: services from before the indexed tag, found through their authors
        { kinds, authors, limit: 200 },
        tribeHiddenLabelsFilter(moderators),
      ], { signal }), moderators);
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
export function useVillageServices(villageSlug: string, filters: ServiceFilters = {}) {
  const { nostr } = useNostr();
  const { preferences } = useVillagePreferences();

  const { search, ...queryFilters } = filters;
  return useQuery({
    queryKey: ['village-services', villageSlug, queryFilters, preferences.hiddenTribes],
    select: (events: NostrEvent[]) => search ? events.filter(event => event.content.toLowerCase().includes(search.toLowerCase())) : events,
    staleTime: 30000, // Consider data fresh for 30 seconds
    queryFn: async (c) => {
      const { signal } = c;

      // Build filter for both offers and requests
      const kinds: number[] = [];
      if (!filters.type || filters.type === 'offer') kinds.push(38857);
      if (!filters.type || filters.type === 'request') kinds.push(30627);


      const villageEvents = await readVillageFeed(nostr, villageSlug === 'main' ? [] : [villageSlug],
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
      lat: number;
      lon: number;
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
        ['l', `${data.lat.toFixed(4)},${data.lon.toFixed(4)}`], // Round for privacy
        ['alt', `Service ${data.type} for local community help`],
      ];

      // Add optional tags
      if (data.area) tags.push(['area', data.area]);
      if (data.avail) tags.push(['avail', data.avail]);
      if (data.time) tags.push(['time', data.time]);
      if (data.rate) tags.push(['rate', data.rate]);
      if (data.radius) tags.push(['radius', data.radius]);
      if (data.expires) tags.push(['expires', data.expires.toString()]);

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
      // Generate a unique d tag for the match
      const dTag = `match-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Build tags array
      const tags: string[][] = [
        ['d', dTag],
        ['type', data.type],
        ['by', user.pubkey],
        ['alt', 'Service match connecting community members'],
      ];

      // Add service references
      if (data.requestARef) tags.push(['a', data.requestARef]);
      if (data.offerARef) tags.push(['a', data.offerARef]);

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
  const locationTag = event.tags.find(([name]) => name === 'l')?.[1];

  // Required tags
  if (!dTag || !tribeTag || !categoryTag || !locationTag) return false;

  // Validate category
  if (!SERVICE_CATEGORIES.includes(categoryTag as ServiceCategory)) return false;

  // Validate location format (lat,lon)
  const locationParts = locationTag.split(',');
  if (locationParts.length !== 2) return false;

  const [lat, lon] = locationParts.map(Number);
  if (isNaN(lat) || isNaN(lon)) return false;

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
    expires: getTag('expires') ? parseInt(getTag('expires')!) : undefined,
  };
}

// Helper function to calculate distance (simplified)
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Helper function to format distance
export function formatDistance(miles: number): string {
  if (miles < 0.1) return '~1 block';
  if (miles < 0.25) return '~3 blocks';
  if (miles < 0.5) return '~½ mile';
  if (miles < 1) return '~¾ mile';
  return `~${Math.round(miles)} mile${miles === 1 ? '' : 's'}`;
}