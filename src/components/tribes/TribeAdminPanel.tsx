import { useState } from "react";
import type { NostrEvent } from "@nostrify/nostrify";
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNostrPublish } from "@/hooks/useNostrPublish";
import { useUpdateTribe } from "@/hooks/useTribesActions";
import { useAuthor } from "@/hooks/useAuthor";
import { dedupeMemberTags, isTribeCreator, isTribeModerator, tribeMembers, tribeModerators, withMemberRole } from "@/lib/tribes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/useToast";
import { genUserName } from "@/lib/genUserName";
import { generateTribeServicesQR, generateTribeServicesPoster, downloadQRCode, downloadSVGPoster } from "@/lib/qrGenerator";
import { AdminServicesPanel } from "../services/AdminServicesPanel";
import { VillageAssociationDialog } from "./VillageAssociationDialog";
import { Settings, UserCheck, UserX, Users, Loader2, QrCode, Download, MapPin } from "lucide-react";

interface TribeAdminPanelProps {
  tribe: NostrEvent;
  tribeId: string;
}

interface JoinRequestCardProps {
  request: NostrEvent;
  onApprove: (request: NostrEvent) => void;
  onReject: (request: NostrEvent) => void;
  isProcessing: boolean;
  canApprove: boolean;
}

function JoinRequestCard({ request, onApprove, onReject, isProcessing, canApprove }: JoinRequestCardProps) {
  const author = useAuthor(request.pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name || metadata?.display_name || genUserName(request.pubkey);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={metadata?.picture} alt={displayName} />
              <AvatarFallback>
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <h4 className="font-medium">{displayName}</h4>
              <p className="text-sm text-muted-foreground">
                {new Date(request.created_at * 1000).toLocaleDateString()}
              </p>
              {request.content && (
                <p className="text-sm text-muted-foreground mt-1">
                  "{request.content}"
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {canApprove && (
              <Button
                size="sm"
                onClick={() => onApprove(request)}
                disabled={isProcessing}
                aria-label={`Approve ${displayName}`}
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserCheck className="h-4 w-4" />
                )}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReject(request)}
              disabled={isProcessing}
              aria-label={`Reject ${displayName}`}
            >
              <UserX className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TribeAdminPanel({ tribe, tribeId }: TribeAdminPanelProps) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: createEvent, isPending: isRejecting } = useNostrPublish();
  const { mutateAsync: updateTribe, isPending: isUpdating } = useUpdateTribe();
  const isProcessing = isRejecting || isUpdating;
  const { toast } = useToast();

  const [processingRequest, setProcessingRequest] = useState<string | null>(null);
  const [isCleaningDuplicates, setIsCleaningDuplicates] = useState(false);
  const [isGeneratingQR, setIsGeneratingQR] = useState(false);

  // Only the creator's key can change the tribe definition (approve, clean up members).
  // Moderators can review and reject requests.
  const isCreator = isTribeCreator(tribe, user?.pubkey);
  const isModerator = isTribeModerator(tribe, user?.pubkey);
  const moderators = new Set(tribeModerators(tribe));

  // Query for join requests and rejections
  const { data: joinRequests, isLoading: requestsLoading, refetch } = useQuery({
    queryKey: ['join-requests', tribeId],
    queryFn: async (c) => {
      const { signal } = c;

      // Get join requests and rejection events
      const [requests, rejections] = await Promise.all([
        nostr.query([
          {
            kinds: [9021], // Join request (NIP-29)
            '#h': [tribeId],
            limit: 100,
          }
        ], { signal }),
        nostr.query([
          {
            kinds: [9022], // Join rejection (custom kind)
            '#h': [tribeId],
            limit: 100,
          }
        ], { signal })
      ]);

      // Get current tribe members
      const currentMembers = new Set(
        tribe.tags
          .filter(([name]) => name === 'p')
          .map(([, pubkey]) => pubkey)
      );

      // Get rejected pubkeys (only rejections issued by this tribe's moderators count)
      const rejectedPubkeys = new Set(
        rejections.filter(rejection => moderators.has(rejection.pubkey)).map(rejection => {
          const rejectedPubkey = rejection.tags.find(([name]) => name === 'p')?.[1];
          return rejectedPubkey;
        }).filter(Boolean)
      );

      // Filter out requests from users who are already members or have been rejected
      const filteredRequests = requests.filter(request => {
        return !currentMembers.has(request.pubkey) && !rejectedPubkeys.has(request.pubkey);
      });

      // Remove duplicate requests (keep only the latest per user)
      const uniqueRequests = filteredRequests.reduce((acc, request) => {
        const existing = acc.find(r => r.pubkey === request.pubkey);
        if (!existing || request.created_at > existing.created_at) {
          return [...acc.filter(r => r.pubkey !== request.pubkey), request];
        }
        return acc;
      }, [] as NostrEvent[]);

      return uniqueRequests.sort((a, b) => b.created_at - a.created_at);
    },
    enabled: isModerator,
  });

  const handleApprove = async (request: NostrEvent) => {
    setProcessingRequest(request.id);

    try {
      // Check if user is already a member
      const isAlreadyMember = tribe.tags.some(([name, pubkey]) =>
        name === 'p' && pubkey === request.pubkey
      );

      if (isAlreadyMember) {
        toast({
          title: "Already a Member",
          description: "This user is already a member of the tribe",
          variant: "destructive",
        });
        refetch();
        return;
      }

      await updateTribe({
        tribe,
        update: latest => ({ tags: withMemberRole(latest.tags, request.pubkey, tribeMembers(latest).get(request.pubkey) ?? 'member') }),
      });
      await refetch();

      toast({
        title: "✅ Member Approved!",
        description: "User has been added to the tribe",
      });

    } catch (error) {
      console.error('Error approving member:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to approve member",
        variant: "destructive",
      });
    } finally {
      setProcessingRequest(null);
    }
  };

  const handleReject = async (request: NostrEvent) => {
    setProcessingRequest(request.id);

    try {
      // Create a rejection event to track rejected users
      await createEvent({
        kind: 9022, // Join rejection (custom kind)
        content: `Join request rejected for tribe ${tribeId}`,
        tags: [
          ['h', tribeId], // Group identifier
          ['p', request.pubkey], // Rejected user
          ['e', request.id], // Original request event
        ],
      });

      toast({
        title: "❌ Request Rejected",
        description: "Join request has been rejected and removed",
      });
      await refetch();

    } catch (error) {
      console.error('Error rejecting member:', error);
      toast({
        title: "Error",
        description: "Failed to reject request",
        variant: "destructive",
      });
    } finally {
      setProcessingRequest(null);
    }
  };

  const cleanDuplicateMembers = async () => {
    setIsCleaningDuplicates(true);

    try {
      const originalMemberCount = tribe.tags.filter(([name]) => name === 'p').length;
      const cleanedMemberCount = dedupeMemberTags(tribe.tags).filter(([name]) => name === 'p').length;

      if (originalMemberCount === cleanedMemberCount) {
        toast({
          title: "No Duplicates Found",
          description: "This tribe doesn't have any duplicate members",
        });
        return;
      }

      await updateTribe({ tribe, update: latest => ({ tags: dedupeMemberTags(latest.tags) }) });

      toast({
        title: "✅ Duplicates Cleaned!",
        description: `Removed ${originalMemberCount - cleanedMemberCount} duplicate member entries`,
      });

    } catch (error) {
      console.error('Error cleaning duplicates:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to clean duplicate members",
        variant: "destructive",
      });
    } finally {
      setIsCleaningDuplicates(false);
    }
  };

  const handleGenerateQR = async () => {
    setIsGeneratingQR(true);
    try {
      const tribeName = tribe.tags.find(([name]) => name === 'name')?.[1] ||
                       tribe.tags.find(([name]) => name === 'd')?.[1] ||
                       'Tribe';

      const qrDataUrl = await generateTribeServicesQR(tribeId);
      downloadQRCode(qrDataUrl, `${tribeName}-services-qr.png`);

      toast({
        title: "QR Code Generated",
        description: "Services QR code has been downloaded",
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to generate QR code",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingQR(false);
    }
  };

  const handleGeneratePoster = async () => {
    setIsGeneratingQR(true);
    try {
      const tribeName = tribe.tags.find(([name]) => name === 'name')?.[1] ||
                       tribe.tags.find(([name]) => name === 'd')?.[1] ||
                       'Tribe';

      const poster = await generateTribeServicesPoster(tribeId, tribeName);
      downloadSVGPoster(poster, `${tribeName}-services-poster.svg`);

      toast({
        title: "Poster Generated",
        description: "Services poster has been downloaded",
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to generate poster",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingQR(false);
    }
  };

  if (!isModerator) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Tribe Administration
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="requests">
          <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="requests" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Requests
              {joinRequests && joinRequests.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {joinRequests.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="moderate-services" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Services
            </TabsTrigger>
            <TabsTrigger value="services-qr" className="flex items-center gap-2">
              <QrCode className="h-4 w-4" />
              QR Codes
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="requests" className="space-y-4">
            {requestsLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 bg-muted rounded-full animate-pulse" />
                        <div className="space-y-2">
                          <div className="h-4 w-24 bg-muted rounded animate-pulse" />
                          <div className="h-3 w-16 bg-muted rounded animate-pulse" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : joinRequests && joinRequests.length > 0 ? (
              <div className="space-y-4">
                {!isCreator && (
                  <p className="text-sm text-muted-foreground">
                    Only the tribe creator can approve members. Moderators can reject requests.
                  </p>
                )}
                {joinRequests.map((request) => (
                  <JoinRequestCard
                    key={request.id}
                    request={request}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    isProcessing={processingRequest === request.id || isProcessing}
                    canApprove={isCreator}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <h3 className="font-semibold mb-1">No pending requests</h3>
                <p className="text-sm text-muted-foreground">
                  Join requests will appear here for approval
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="moderate-services">
            <AdminServicesPanel tribeId={tribeId} />
          </TabsContent>

          <TabsContent value="services-qr" className="space-y-6">
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-2">Services QR Codes</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Generate QR codes and posters to promote your tribe's services
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Button
                    onClick={handleGenerateQR}
                    disabled={isGeneratingQR}
                    variant="outline"
                    className="h-auto p-4 flex flex-col items-center gap-2"
                  >
                    {isGeneratingQR ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      <QrCode className="h-6 w-6" />
                    )}
                    <div className="text-center">
                      <div className="font-medium">QR Code</div>
                      <div className="text-xs text-muted-foreground">
                        Download PNG for digital use
                      </div>
                    </div>
                  </Button>

                  <Button
                    onClick={handleGeneratePoster}
                    disabled={isGeneratingQR}
                    variant="outline"
                    className="h-auto p-4 flex flex-col items-center gap-2"
                  >
                    {isGeneratingQR ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      <Download className="h-6 w-6" />
                    )}
                    <div className="text-center">
                      <div className="font-medium">Poster</div>
                      <div className="text-xs text-muted-foreground">
                        Download SVG for printing
                      </div>
                    </div>
                  </Button>
                </div>
              </div>

              <div className="p-4 bg-muted rounded-lg">
                <h4 className="font-medium mb-2">How to use:</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• QR Code: Share digitally or print for local posting</li>
                  <li>• Poster: Print and display in community spaces</li>
                  <li>• Both link directly to your tribe's Services tab</li>
                  <li>• Helps neighbors discover and offer local services</li>
                </ul>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="space-y-6">
            <div className="space-y-6">
              {!isCreator && (
                <p className="text-sm text-muted-foreground">
                  Only the tribe creator can change villages and membership, because the tribe
                  definition is signed with their key.
                </p>
              )}
              <div>
                <h3 className="text-lg font-semibold mb-2">Village Associations</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Associate this tribe with villages to make content discoverable in village feeds
                </p>

                <VillageAssociationDialog tribe={tribe}>
                  <Button variant="outline" disabled={!isCreator}>
                    <MapPin className="h-4 w-4 mr-2" />
                    Manage Villages
                  </Button>
                </VillageAssociationDialog>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2">Member Management</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Clean up duplicate member entries
                </p>

                <Button
                  onClick={cleanDuplicateMembers}
                  disabled={isCleaningDuplicates || !isCreator}
                  variant="outline"
                >
                  {isCleaningDuplicates ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Users className="h-4 w-4 mr-2" />
                  )}
                  Clean Duplicate Members
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}