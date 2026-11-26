import { useEvent, useEventRSVPs, useUserRSVP, useEventAttendance } from "@/hooks/useEvents";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { EventHeader } from "./EventHeader";
import { EventRSVP } from "./EventRSVP";
import { EventAttendeeList } from "./EventAttendeeList";
import { EventCheckIn } from "./EventCheckIn";
import { AttendeeCheckIn } from "./AttendeeCheckIn";
import { EventDiscussion } from "./EventDiscussion";
import { EventCoordinationTabs } from "./EventCoordinationTabs";
import { useCoordinationTrust } from "@/hooks/useEventCoordination";
import { useEventAccess } from "@/hooks/useEventAccess";
import type { EventVisibility } from "@/lib/eventVisibility";
import type { NostrEvent } from "@nostrify/nostrify";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RelaySelector } from "@/components/RelaySelector";
import { LoginArea } from "@/components/auth/LoginArea";
import { Users, QrCode, Trophy, MessageCircle, ClipboardList, Lock } from "lucide-react";

interface EventViewProps {
  eventId: string;
}

/**
 * The event page, for every way of reaching an event: the /event route, and naddr, nevent
 * and note links, which all end up here. Who is shown the event is decided before anything
 * about it is rendered or read (see lib/eventVisibility).
 */
export function EventView({ eventId }: EventViewProps) {
  const { user } = useCurrentUser();
  const { data: event, isLoading: eventLoading, error: eventError } = useEvent(eventId);
  const access = useEventAccess(event);

  // Also while a tribe-only event waits for its member list: until that is known the event
  // is neither shown nor refused.
  if (eventLoading || (event && access.state === 'checking')) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-4">
          <Skeleton className="h-64 w-full rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <div className="max-w-sm mx-auto space-y-6">
              <div className="text-4xl">🤷‍♂️</div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">{eventError ? 'Could not load event' : 'Event not found'}</h3>
                <p className="text-muted-foreground">
                  {eventError ? "The relay lookup failed. Try switching relays." : "No matching event was found on the current relays."}
                </p>
              </div>
              <RelaySelector className="w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (access.state === 'unverified') {
    return <MembershipUnverified onRetry={access.retry} />;
  }

  if (access.state !== 'visible') {
    return <RestrictedEvent visibility={access.visibility} loggedIn={!!user} />;
  }

  return <EventDetails event={event} eventId={eventId} />;
}

/** Shown instead of a tribe-only event when its tribe's member list could not be read. */
function MembershipUnverified({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="max-w-2xl mx-auto">
      <Card className="border-dashed">
        <CardContent className="py-12 px-8 text-center">
          <div className="max-w-sm mx-auto space-y-6">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">Could not check your tribe membership</h3>
              <p className="text-muted-foreground">
                This event is for the members of its tribe, and the tribe's member list did not load
                from the current relays.
              </p>
            </div>
            <Button onClick={onRetry}>Try again</Button>
            <RelaySelector className="w-full" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Shown instead of an event the viewer is not among the audience of. Says nothing about it. */
function RestrictedEvent({ visibility, loggedIn }: { visibility: EventVisibility; loggedIn: boolean }) {
  return (
    <div className="max-w-2xl mx-auto">
      <Card className="border-dashed">
        <CardContent className="py-12 px-8 text-center">
          <div className="max-w-sm mx-auto space-y-6">
            <Lock className="h-8 w-8 mx-auto text-muted-foreground" aria-hidden="true" />
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">
                {visibility === 'tribe-only'
                  ? 'This event is shown only to members of its tribe'
                  : 'This event is shown only to the people its organizer invited'}
              </h3>
              <p className="text-muted-foreground">
                {loggedIn
                  ? 'The account you are using is not one of them. If another of your accounts is, switch to it.'
                  : 'Log in to see it if that includes you.'}
              </p>
            </div>
            {/* Logged out: log in. Logged in: the account switcher. */}
            <LoginArea className="max-w-60 mx-auto" />
            <p className="text-xs text-muted-foreground">
              This is how Village Vibe presents the event. The listing itself is a public Nostr record.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** The event itself. Mounted only for a viewer the event is shown to, so nothing here reads for anyone else. */
function EventDetails({ event, eventId }: { event: NostrEvent; eventId: string }) {
  const { user } = useCurrentUser();
  const { data: rsvps, isLoading: rsvpsLoading } = useEventRSVPs(eventId);
  const { data: userRSVP } = useUserRSVP(eventId, user?.pubkey);
  const { data: attendanceRecords } = useEventAttendance(eventId);

  // Check if user is the event host
  const isHost = user?.pubkey === event.pubkey;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <EventHeader event={event} userRSVP={userRSVP} />

      <Tabs defaultValue="coordination" className="space-y-6">
        <TabsList>
          <TabsTrigger value="coordination" className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            Coordination
          </TabsTrigger>
          <TabsTrigger value="rsvp" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            RSVP & Attendees
          </TabsTrigger>
          <TabsTrigger value="discussion" className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            Discussion
          </TabsTrigger>
          {isHost && (
            <TabsTrigger value="checkin" className="flex items-center gap-2">
              <QrCode className="h-4 w-4" />
              Check-In
            </TabsTrigger>
          )}
          <TabsTrigger value="badges" className="flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            Badges
          </TabsTrigger>
        </TabsList>

        <TabsContent value="coordination">
          <EventCoordinationSection event={event} isHost={isHost} />
        </TabsContent>

        <TabsContent value="rsvp">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 space-y-6">
              <EventRSVP
                event={event}
                userRSVP={userRSVP}
                eventId={eventId}
              />
              <AttendeeCheckIn
                event={event}
                eventId={eventId}
              />
            </div>
            <div className="lg:col-span-2">
              <EventAttendeeList
                rsvps={rsvps || []}
                isLoading={rsvpsLoading}
                attendanceRecords={attendanceRecords || []}
              />
            </div>
          </div>
        </TabsContent>

        {isHost && (
          <TabsContent value="checkin">
            <EventCheckIn eventId={eventId} event={event} />
          </TabsContent>
        )}

        <TabsContent value="discussion">
          <EventDiscussion event={event} />
        </TabsContent>

        <TabsContent value="badges">
          <div className="text-center py-12">
            <div className="text-4xl mb-4">🏆</div>
            <h3 className="text-lg font-semibold mb-2">Event Badges</h3>
            <p className="text-muted-foreground">
              Attendance badges will be shown here after the event.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Coordination tabs; tribe moderators can manage alongside the organizer. */
function EventCoordinationSection({ event, isHost }: { event: NostrEvent; isHost: boolean }) {
  const { user } = useCurrentUser();
  const trusted = useCoordinationTrust(event);
  return (
    <EventCoordinationTabs
      event={event}
      isOrganizer={isHost}
      isModerator={!!user && !isHost && trusted.has(user.pubkey)}
    />
  );
}
