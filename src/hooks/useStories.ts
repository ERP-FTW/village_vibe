import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { readVillageFeed } from '@/lib/villageFeed';
import { locationTags } from '@/lib/location';
import { belongsToTribe, tribeCoordinate, tribeLinkTags, villagesOf, withVillageTags } from '@/lib/contentTags';
import { useNostr } from '@nostrify/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useVillagePreferences } from './useVillagePreferences';
import { useTribe } from './useTribes';
import { MAX_FEED_AUTHORS, tribeMemberAuthors, tribeModerators } from '@/lib/tribes';
import { dropHidden } from '@/lib/moderation';

// Story filter options
export interface StoryFilters {
  tribe?: string;
  village?: string;
  search?: string;
  featured?: boolean;
  limit?: number;
  /** Village feeds: windows of promotion labels to read (see readVillageFeed). */
  promotionPages?: number;
}

function searchStories(events: NostrEvent[], search?: string) {
  if (!search) return events;
  const term = search.toLowerCase();
  return events.filter(event => event.content.toLowerCase().includes(term) ||
    event.tags.some(([name, value]) => (name === 'title' || name === 'summary') && value?.toLowerCase().includes(term)));
}

// Hook to get stories for a specific tribe
export function useTribeStories(tribeId: string, filters: StoryFilters = {}) {
  const { nostr } = useNostr();
  // Feed authors come from the tribe's member list: refetch whenever that definition changes.
  const tribeQuery = useTribe(tribeId);
  const tribeVersion = tribeQuery.data?.id ?? null;

  const { search, ...queryFilters } = filters;
  return useQuery({
    queryKey: ['tribe-stories', tribeId, tribeVersion, queryFilters],
    select: (events: NostrEvent[]) => searchStories(events, search),
    enabled: tribeQuery.isFetched,
    queryFn: async (c) => {
      const { signal } = c;

      // Parse tribe coordinates
      const [pubkey, dTag] = tribeId.split(':');
      if (!pubkey || !dTag) return [];

      // Any member can publish stories in their tribe.
      const tribe = tribeQuery.data ?? null;
      const authors = tribe ? tribeMemberAuthors(tribe).slice(0, MAX_FEED_AUTHORS) : [pubkey];
      const moderators = tribe ? tribeModerators(tribe) : [pubkey];
      const allowed = new Set(tribe ? tribeMemberAuthors(tribe) : [pubkey]);
      const records = await dropHidden(nostr, await nostr.query([
        // Indexed: stories tagged with the tribe coordinate
        { kinds: [30023], '#a': [tribeCoordinate(tribeId)], limit: 200 },
        // Legacy: stories from before the indexed tag, found through their authors
        { kinds: [30023], authors, limit: 200 },
      ], { signal }), moderators, signal);
      const filteredEvents = records.filter(event =>
        allowed.has(event.pubkey) && belongsToTribe(event.tags, tribeId));

      const validEvents = filteredEvents.filter(validateStoryEvent);

      // Sort by creation date (newest first)
      return validEvents.sort((a, b) => b.created_at - a.created_at);
    },
  });
}

// Hook to get a specific story
export function useStory(storyId: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['story', storyId],
    queryFn: async (c) => {
      const { signal } = c;

      // Parse story coordinates (format: pubkey:d-identifier)
      const [pubkey, dTag] = storyId.split(':');
      if (!pubkey || !dTag) {
        throw new Error('Invalid story ID format');
      }

      const events = await nostr.query([
        {
          kinds: [30023],
          authors: [pubkey],
          '#d': [dTag],
          limit: 1,
        }
      ], { signal });

      const event = events[0];
      return event && validateStoryEvent(event) ? event : null;
    },
  });
}

// Hook to get story labels (for moderation)
export function useStoryLabels(storyId: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['story-labels', storyId],
    queryFn: async (c) => {
      const { signal } = c;

      // Parse story coordinates
      const [pubkey, dTag] = storyId.split(':');
      if (!pubkey || !dTag) return [];

      // Query for labels targeting this story
      const aRef = `30023:${pubkey}:${dTag}`;
      const events = await nostr.query([
        {
          kinds: [1985], // Label (NIP-32)
          '#a': [aRef],
          limit: 50,
        }
      ], { signal });

      return events.filter(validateLabelEvent);
    },
  });
}

// Hook to create or update a story
export function useCreateStory() {
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: {
      tribe: string;
      title: string;
      summary?: string;
      content: string;
      cover?: string;
      place?: string;
      lat?: number;
      lon?: number;
      refEventId?: string;
      villages?: string[];
      dTag?: string; // For updates
    }) => {
      // Generate a unique d tag if not provided (for updates)
      const dTag = data.dTag || `story-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Build tags array
      const tags: string[][] = [
        ['d', dTag],
        // Indexed tribe coordinate plus the legacy d-tag reference
        ...tribeLinkTags(data.tribe),
        ['title', data.title],
        ['alt', 'Community story shared with the village'],
      ];

      // Add optional tags
      if (data.summary) tags.push(['summary', data.summary]);
      if (data.cover) tags.push(['cover', data.cover]);
      if (data.place) tags.push(['place', data.place]);
      // Optional, coarse location (geohash cell of about 1 km)
      tags.push(...locationTags(data.lat, data.lon));
      if (data.refEventId) tags.push(['ref', data.refEventId]);

      // Add village tags (legacy + indexed)
      tags.splice(0, tags.length, ...withVillageTags(tags, data.villages ?? []));

      // Create the event
      const eventData = {
        kind: 30023,
        content: data.content,
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };

      await publish(eventData);
      return { ...data, dTag, eventData };
    },
  });
}

// Hook to create a story label (for moderation)
export function useCreateStoryLabel() {
  const queryClient = useQueryClient();
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: {
      storyId: string;
      label: string;
      /** Villages a promotion or feature label applies to. */
      villages?: string[];
      namespace?: string;
      content?: string;
    }) => {
      // Parse story coordinates
      const [pubkey, dTag] = data.storyId.split(':');
      if (!pubkey || !dTag) {
        throw new Error('Invalid story ID format');
      }

      // Build tags array
      const tags: string[][] = [
        ['a', `30023:${pubkey}:${dTag}`],
        ['l', data.label, data.namespace || 'ugc'],
        ['alt', `Story moderation label: ${data.label}`],
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
      // Invalidate labels for this story
      queryClient.invalidateQueries({
        queryKey: ['story-labels', variables.storyId]
      });

      // If this is a village promotion, invalidate village stories
      if (variables.label === 'village-promoted') {
        queryClient.invalidateQueries({
          queryKey: ['village-stories']
        });
        queryClient.invalidateQueries({
          queryKey: ['multi-village-stories']
        });
      }
    },
  });
}

// Hook to promote a story to villages (creates label AND updates story with village tags)
export function usePromoteStoryToVillages() {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: {
      story: NostrEvent;
      villages: string[];
      reason?: string;
    }) => {
      const { story, villages, reason } = data;

      // Parse story data
      const dTag = story.tags.find(([name]) => name === 'd')?.[1];
      if (!dTag) {
        throw new Error('Story missing d tag');
      }

      const storyId = `${story.pubkey}:${dTag}`;

      // Get existing village tags
      const existingVillageTags = villagesOf(story.tags);
      const newVillages = villages.filter(v => !existingVillageTags.includes(v));
      const allVillages = [...existingVillageTags, ...newVillages];

      // Create updated story with village tags
      const updatedTags = withVillageTags(story.tags, allVillages);

      const updatedStory = {
        kind: 30023,
        content: story.content,
        tags: updatedTags,
        created_at: Math.floor(Date.now() / 1000),
      };

      // Create promotion label
      const labelTags: string[][] = [
        ['a', `30023:${story.pubkey}:${dTag}`],
        ['l', 'village-promoted', 'promotion'],
        ['L', 'promotion'],
        ['alt', `Story promoted to villages: ${villages.join(', ')}`],
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
      const target = data.story;
      if (user?.pubkey === target.pubkey) await publish(updatedStory);
      await publish(promotionLabel);
      return {
        storyId,
        updatedStory,
        promotionLabel,
        villages: allVillages,
      };
    },
    onSuccess: (result) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({
        queryKey: ['story', result.storyId]
      });
      queryClient.invalidateQueries({
        queryKey: ['story-labels', result.storyId]
      });
      queryClient.invalidateQueries({
        queryKey: ['tribe-stories']
      });
      queryClient.invalidateQueries({
        queryKey: ['village-stories']
      });
      queryClient.invalidateQueries({
        queryKey: ['multi-village-stories']
      });

      // Invalidate specific village queries
      result.villages.forEach(village => {
        queryClient.invalidateQueries({
          queryKey: ['village-stories', village]
        });
      });
    },
  });
}

// Validate story event structure
export function validateStoryEvent(event: NostrEvent): boolean {
  if (event.kind !== 30023) return false;

  const dTag = event.tags.find(([name]) => name === 'd')?.[1];
  const tribeTag = event.tags.find(([name]) => name === 'tribe')?.[1];
  const titleTag = event.tags.find(([name]) => name === 'title')?.[1];

  // Required tags
  if (!dTag || !tribeTag || !titleTag) return false;

  // Content should not be empty
  if (!event.content.trim()) return false;

  return true;
}

// Validate label event structure
export function validateLabelEvent(event: NostrEvent): boolean {
  if (event.kind !== 1985) return false;

  const aTag = event.tags.find(([name]) => name === 'a')?.[1];
  const lTag = event.tags.find(([name]) => name === 'l')?.[1];

  if (!aTag || !lTag) return false;

  // Check if it's targeting a story
  if (!aTag.startsWith('30023:')) return false;

  return true;
}

// Helper function to extract story data from event
export function extractStoryData(event: NostrEvent) {
  const tags = event.tags;
  const getTag = (name: string) => tags.find(([n]) => n === name)?.[1];
  const getAllTags = (name: string) => tags.filter(([n]) => n === name).map(([, value]) => value);

  return {
    id: event.id,
    pubkey: event.pubkey,
    content: event.content,
    createdAt: event.created_at,
    dTag: getTag('d'),
    tribe: getTag('tribe'),
    villages: getAllTags('village'),
    title: getTag('title'),
    summary: getTag('summary'),
    cover: getTag('cover'),
    place: getTag('place'),
    location: getTag('l'),
    refEventId: getTag('ref'),
    publishedAt: getTag('published_at'),
  };
}

// Hook to get stories for multiple villages (for village feed preferences)
export function useMultiVillageStories(villages: string[], filters: StoryFilters = {}) {
  const { nostr } = useNostr();
  const { preferences } = useVillagePreferences();

  const { search, ...queryFilters } = filters;
  return useQuery({
    queryKey: ['multi-village-stories', villages, queryFilters, preferences.hiddenTribes],
    select: (feed: { stories: NostrEvent[]; featured: string[]; promotionsComplete: boolean; promotionsCanReadFurther: boolean }) => ({ ...feed, stories: searchStories(feed.stories, search) }),
    staleTime: 30000, // Consider data fresh for 30 seconds
    queryFn: async (c) => {
      const { signal } = c;


      const { events: villageEvents, featured, promotionsComplete, promotionsCanReadFurther } = await readVillageFeed(nostr, villages,
        [{ kinds: [30023], limit: filters.limit || 200 }], signal, { promotionPages: filters.promotionPages });

      // Apply additional filters
      const filteredEvents = villageEvents;


      const validEvents = filteredEvents.filter(validateStoryEvent);

      // Filter out stories from hidden tribes
      const nonHiddenEvents = validEvents.filter(event => {
        const tribeTag = event.tags.find(([name]) => name === 'tribe')?.[1];
        return !tribeTag || !preferences.hiddenTribes.includes(tribeTag);
      });


      // Deduplicate events by ID and sort by creation date (newest first)
      const uniqueEvents = Array.from(
        new Map(nonHiddenEvents.map(event => [event.id, event])).values()
      );

      return {
        stories: uniqueEvents.sort((a, b) => b.created_at - a.created_at),
        // Coordinates a moderator of the story's tribe featured in these villages
        featured: [...featured],
        // False when promotions may have been missed; whether more windows can help
        promotionsComplete,
        promotionsCanReadFurther,
      };
    },
  });
}

// Helper function to check if story is promoted to village
export function isStoryPromoted(event: NostrEvent): boolean {
  return event.tags.some(([name]) => name === 'village');
}

// Helper function to get story coordinates (for naddr)
export function getStoryCoordinates(event: NostrEvent): string {
  const dTag = event.tags.find(([name]) => name === 'd')?.[1];
  if (!dTag) return '';
  return `${event.pubkey}:${dTag}`;
}