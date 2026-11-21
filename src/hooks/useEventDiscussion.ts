import { NKinds, NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

export function useEventDiscussion(event: NostrEvent, limit?: number) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['event-discussion', event.id, limit],
    queryFn: async (c) => {
      const { signal } = c;

      // Get the event identifier for addressable events
      const d = event.tags.find(([name]) => name === 'd')?.[1] ?? '';
      const eventCoord = `${event.kind}:${event.pubkey}:${d}`;

      // Query for multiple types of replies/comments
      const filters: NostrFilter[] = [];

      // 1. NIP-22 Comments (kind 1111) that reference this event
      if (NKinds.addressable(event.kind)) {
        filters.push({
          kinds: [1111],
          '#A': [eventCoord],
        });
      } else {
        filters.push({
          kinds: [1111],
          '#E': [event.id],
        });
      }

      // 2. Regular notes (kind 1) that reference this event via 'a' tag (addressable)
      filters.push({
        kinds: [1],
        '#a': [eventCoord],
      });

      // 3. Regular notes that reply to the event directly via 'e' tag
      filters.push({
        kinds: [1],
        '#e': [event.id],
      });

      // Add limit to each filter
      if (typeof limit === 'number') {
        filters.forEach(filter => {
          filter.limit = Math.ceil(limit / filters.length);
        });
      }

      // Query all types of discussions
      const allEvents = await nostr.query(filters, { signal });




      // Remove duplicates by ID
      const uniqueEvents = Array.from(
        new Map(allEvents.map(e => [e.id, e])).values()
      );

      // Helper function to get tag value
      const getTagValue = (event: NostrEvent, tagName: string): string | undefined => {
        const tag = event.tags.find(([name]) => name === tagName);
        return tag?.[1];
      };

      // Separate top-level comments from replies - simplified logic
      const topLevelComments = uniqueEvents.filter(comment => {
        const eTag = getTagValue(comment, 'e');
        const aTag = getTagValue(comment, 'a');

        // Direct replies to this event via 'e' tag
        if (eTag === event.id) {
          return true;
        }

        // Direct references to this event via 'a' tag (addressable)
        if (aTag === eventCoord) {
          return true;
        }

        return false;
      });




      // Helper function to get all replies to a comment
      const getReplies = (parentId: string): NostrEvent[] => {
        return uniqueEvents.filter(comment => {
          const eTags = comment.tags.filter(([name]) => name === 'e' || name === 'E');
          // Check if this comment replies to the parent (has parent ID in e tags, but not as the only tag)
          return eTags.some(([, value]) => value === parentId) &&
                 eTags.length > 1; // Has multiple e tags (reply chain)
        });
      };

      // Helper function to get all descendants of a comment
      const getDescendants = (parentId: string): NostrEvent[] => {
        const directReplies = getReplies(parentId);
        const allDescendants = [...directReplies];

        // Recursively get descendants of each direct reply
        for (const reply of directReplies) {
          allDescendants.push(...getDescendants(reply.id));
        }

        return allDescendants;
      };

      // Sort top-level comments by creation time (newest first)
      const sortedTopLevel = topLevelComments.sort((a, b) => b.created_at - a.created_at);

      return {
        allComments: uniqueEvents,
        topLevelComments: sortedTopLevel,
        getDescendants: (commentId: string) => {
          const descendants = getDescendants(commentId);
          // Sort descendants by creation time (oldest first for threaded display)
          return descendants.sort((a, b) => a.created_at - b.created_at);
        },
        getDirectReplies: (commentId: string) => {
          const directReplies = getReplies(commentId);
          // Sort direct replies by creation time (oldest first for threaded display)
          return directReplies.sort((a, b) => a.created_at - b.created_at);
        }
      };
    },
    enabled: !!event,
  });
}