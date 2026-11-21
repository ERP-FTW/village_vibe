import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNostrPublish } from "@/hooks/useNostrPublish";
import { useToast } from "@/hooks/useToast";
import { useNostr } from '@nostrify/react';
import { useMutation } from '@tanstack/react-query';
import type { NostrEvent } from "@nostrify/nostrify";
import { TRIBE_KIND, tribeDTag, tribeModerators } from '@/lib/tribes';

export function useJoinTribe() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: createEvent, isPending } = useNostrPublish();
  const { toast } = useToast();

  const joinTribe = async (tribe: NostrEvent) => {
    if (!user) {
      toast({
        title: "Error",
        description: "You must be logged in to join a tribe",
        variant: "destructive",
      });
      return;
    }

    try {
      const tribeName = tribe.tags.find(([name]) => name === 'name')?.[1] ||
                       tribe.tags.find(([name]) => name === 'd')?.[1] ||
                       'Tribe';

      const dTag = tribe.tags.find(([name]) => name === 'd')?.[1];
      if (!dTag) {
        throw new Error('Invalid tribe format');
      }

      const tribeId = `${tribe.pubkey}:${dTag}`;

      // Check if user is already a member
      const isAlreadyMember = tribe.tags.some(([name, pubkey]) =>
        name === 'p' && pubkey === user.pubkey
      );

      if (isAlreadyMember) {
        toast({
          title: "Already a Member",
          description: "You are already a member of this tribe",
          variant: "destructive",
        });
        return;
      }

      // One request for prior rejections (only from this tribe's moderators count) and pending requests
      const moderators = new Set(tribeModerators(tribe));
      const prior = await nostr.query([
        { kinds: [9022], '#h': [tribeId], '#p': [user.pubkey], limit: 20 },
        { kinds: [9021], '#h': [tribeId], authors: [user.pubkey], limit: 5 },
      ]);

      if (prior.some(event => event.kind === 9022 && moderators.has(event.pubkey))) {
        toast({
          title: "Request Previously Rejected",
          description: "Your join request was rejected by the tribe admins",
          variant: "destructive",
        });
        return;
      }

      if (prior.some(event => event.kind === 9021)) {
        toast({
          title: "Request Already Pending",
          description: "You already have a pending join request for this tribe",
          variant: "destructive",
        });
        return;
      }

      // Send a join request event using NIP-29 format
      // This creates a join request that tribe admins can see and process
      await createEvent({
        kind: 9021, // Join request (NIP-29)
        content: `Requesting to join ${tribeName}`,
        tags: [
          ['h', tribeId], // Group identifier
          ['p', tribe.pubkey], // Tribe creator
        ],
      });

      toast({
        title: "Join request sent",
        description: `The admins of ${tribeName} will review your request.`,
      });

    } catch (error) {
      console.error('Error joining tribe:', error);
      toast({
        title: "Error",
        description: "Failed to join tribe. Please try again.",
        variant: "destructive",
      });
    }
  };

  return { joinTribe, isPending };
}
/**
 * Change a tribe definition (kind 34550) safely:
 * - only the creator's key can replace it, so anyone else is refused instead of
 *   silently publishing a fork under their own key;
 * - the newest version is fetched first, so concurrent edits (e.g. approving two
 *   requests in a row) build on each other instead of overwriting each other.
 */
export function useUpdateTribe() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publish } = useNostrPublish();

  return useMutation({
    mutationFn: async ({ tribe, update }: {
      tribe: NostrEvent;
      update: (latest: NostrEvent) => { tags: string[][]; content?: string };
    }) => {
      if (!user || user.pubkey !== tribe.pubkey) {
        throw new Error('Only the tribe creator can change the tribe definition.');
      }
      const [latest] = await nostr.query([{
        kinds: [TRIBE_KIND], authors: [tribe.pubkey], '#d': [tribeDTag(tribe)], limit: 1,
      }]);
      const base = latest && latest.created_at >= tribe.created_at ? latest : tribe;
      const next = update(base);
      return publish({
        kind: TRIBE_KIND,
        content: next.content ?? base.content,
        tags: next.tags,
        // A replacement must be newer than the version it replaces.
        created_at: Math.max(Math.floor(Date.now() / 1000), base.created_at + 1),
      });
    },
  });
}
