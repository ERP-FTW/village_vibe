import type { NostrEvent } from "@nostrify/nostrify";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuthor } from "@/hooks/useAuthor";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useUpdateTribe } from "@/hooks/useTribesActions";
import { isTribeCreator, tribeMembers, withMemberRole } from "@/lib/tribes";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { genUserName } from "@/lib/genUserName";
import { Shield, Crown, User, Calendar, Loader2, UserMinus } from "lucide-react";

interface TribeMembersProps {
  tribe: NostrEvent;
}

interface MemberCardProps {
  pubkey: string;
  role?: string;
  tribe: NostrEvent;
  canManageMembers: boolean;
}

function MemberCard({ pubkey, role, tribe, canManageMembers }: MemberCardProps) {
  const author = useAuthor(pubkey);
  const { mutateAsync: updateTribe, isPending: isUpdating } = useUpdateTribe();
  const { toast } = useToast();
  const [pendingAction, setPendingAction] = useState<'role' | 'remove' | null>(null);

  const metadata = author.data?.metadata;
  const displayName = metadata?.name || metadata?.display_name || genUserName(pubkey);
  const about = metadata?.about;

  const hasEventCreatorRole = role === 'event_creator';

  const changeMember = async (action: 'role' | 'remove') => {
    if (!canManageMembers) return;
    setPendingAction(action);
    try {
      await updateTribe({
        tribe,
        update: latest => ({
          tags: withMemberRole(
            latest.tags,
            pubkey,
            action === 'remove' ? null : (tribeMembers(latest).get(pubkey) === 'event_creator' ? 'member' : 'event_creator'),
          ),
        }),
      });
      toast({
        title: action === 'remove'
          ? 'Member removed'
          : hasEventCreatorRole ? 'Event creator role removed' : 'Event creator role added',
        description: action === 'remove'
          ? `${displayName} has been removed from the tribe`
          : `${displayName} ${hasEventCreatorRole ? 'can no longer' : 'can now'} create events for this tribe`,
      });
    } catch (error) {
      console.error('Error updating member:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update member. Please try again.",
        variant: "destructive",
      });
    } finally {
      setPendingAction(null);
    }
  };

  const getRoleIcon = () => {
    switch (role) {
      case 'admin':
        return <Crown className="h-3 w-3" />;
      case 'moderator':
        return <Shield className="h-3 w-3" />;
      case 'event_creator':
        return <Calendar className="h-3 w-3" />;
      default:
        return <User className="h-3 w-3" />;
    }
  };

  const getRoleVariant = () => {
    switch (role) {
      case 'admin':
        return 'default';
      case 'moderator':
        return 'secondary';
      case 'event_creator':
        return 'default';
      default:
        return 'outline';
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <Avatar className="h-12 w-12">
            <AvatarImage src={metadata?.picture} alt={displayName} />
            <AvatarFallback>
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold truncate">{displayName}</h3>
              {role && (
                <Badge variant={getRoleVariant()} className="text-xs">
                  <div className="flex items-center gap-1">
                    {getRoleIcon()}
                    {role}
                  </div>
                </Badge>
              )}
            </div>

            {about && (
              <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                {about}
              </p>
            )}

            {hasEventCreatorRole && (
              <Badge variant="outline" className="mb-3 text-xs">
                <Calendar className="h-3 w-3 mr-1" />
                Can Create Events
              </Badge>
            )}

            <div className="flex gap-2 flex-wrap">
              <Button asChild variant="outline" size="sm">
                <Link to={`/profile/${pubkey}`}>
                  View Profile
                </Link>
              </Button>

              {canManageMembers && role !== 'admin' && pubkey !== tribe.pubkey && (
                <>
                  <Button
                    variant={hasEventCreatorRole ? "destructive" : "default"}
                    size="sm"
                    onClick={() => changeMember('role')}
                    disabled={isUpdating}
                  >
                    {pendingAction === 'role' ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Calendar className="h-3 w-3 mr-1" />
                    )}
                    {hasEventCreatorRole ? 'Remove Events' : 'Allow Events'}
                  </Button>

                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => changeMember('remove')}
                    disabled={isUpdating}
                  >
                    {pendingAction === 'remove' ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <UserMinus className="h-3 w-3 mr-1" />
                    )}
                    Remove
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TribeMembers({ tribe }: TribeMembersProps) {
  const { user } = useCurrentUser();

  // Only the creator's key can change the tribe definition that holds the member list.
  const canManageMembers = isTribeCreator(tribe, user?.pubkey);
  const memberMap = tribeMembers(tribe);

  const members = Array.from(memberMap, ([pubkey, role]) => ({ pubkey, role }));

  // Separate by role for better organization
  const admins = members.filter(m => m.role === 'admin');
  const moderators = members.filter(m => m.role === 'moderator');
  const eventCreators = members.filter(m => m.role === 'event_creator');
  const regularMembers = members.filter(m => m.role === 'member');

  if (members.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 px-8 text-center">
          <div className="max-w-sm mx-auto space-y-6">
            <div className="text-4xl">👥</div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">No members yet</h3>
              <p className="text-muted-foreground">
                This tribe is waiting for its first members to join
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {/* Admins */}
      {admins.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-yellow-600" />
            <h3 className="text-xl font-semibold">Admins</h3>
            <span className="text-sm text-muted-foreground">({admins.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {admins.map(({ pubkey, role }) => (
              <MemberCard key={pubkey} pubkey={pubkey} role={role} tribe={tribe} canManageMembers={!!canManageMembers} />
            ))}
          </div>
        </div>
      )}

      {/* Moderators */}
      {moderators.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            <h3 className="text-xl font-semibold">Moderators</h3>
            <span className="text-sm text-muted-foreground">({moderators.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {moderators.map(({ pubkey, role }) => (
              <MemberCard key={pubkey} pubkey={pubkey} role={role} tribe={tribe} canManageMembers={!!canManageMembers} />
            ))}
          </div>
        </div>
      )}

      {/* Event Creators */}
      {eventCreators.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-green-600" />
            <h3 className="text-xl font-semibold">Event Creators</h3>
            <span className="text-sm text-muted-foreground">({eventCreators.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {eventCreators.map(({ pubkey, role }) => (
              <MemberCard key={pubkey} pubkey={pubkey} role={role} tribe={tribe} canManageMembers={!!canManageMembers} />
            ))}
          </div>
        </div>
      )}

      {/* Regular Members */}
      {regularMembers.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-gray-600" />
            <h3 className="text-xl font-semibold">Members</h3>
            <span className="text-sm text-muted-foreground">({regularMembers.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {regularMembers.map(({ pubkey, role }) => (
              <MemberCard key={pubkey} pubkey={pubkey} role={role} tribe={tribe} canManageMembers={!!canManageMembers} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}