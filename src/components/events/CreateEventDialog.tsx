import { useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useUploadFile } from "@/hooks/useUploadFile";
import { InvitationRecovery } from "./InvitationRecovery";
import { useCreateEnhancedEvent, useSendPrivateEventDetails, useRetryInvitations, invitationsComplete, type InvitationOutcome, type EventType, type EventVisibility, getEventTypeInfo, EVENT_TYPES } from "@/hooks/useEvents";
import { usePublicTribes } from "@/hooks/useTribes";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/useToast";
import { Upload, Loader2, Calendar, Clock, Plus, X } from "lucide-react";

interface CreateEventDialogProps {
  children: React.ReactNode;
  tribeId: string;
}



// Define the form data type
interface EventFormData {
  title: string;
  summary: string;
  description: string;
  place: string;
  image: string;
  date: string;
  time: string;
  duration: string;
  etypes: EventType[];
  visibility: EventVisibility;
  villages: string[];
  invitees: string[];
  privateDetails: string;
  exactLocation: string;
  sendDMs: boolean;
  enableZaps: boolean;
  enableComments: boolean;
  autoPromptStory: boolean;
  // Type-specific data
  foodSlots: string[];
  dietNotes: string;
  tasks: string[];
  toolsNeeded: string;
  instructors: string[];
  materials: string;
  gameKind: string;
  teamsMode: 'auto' | 'custom';
  occasion: string;
}

// Type-specific fields. Defined at module scope: a component declared inside another
// component is a new type on every render, so React remounts it and inputs lose focus.
function TypeSpecificFields({ formData, setFormData }: {
  formData: EventFormData;
  setFormData: React.Dispatch<React.SetStateAction<EventFormData>>;
}) {
  const addToArray = (field: 'foodSlots' | 'tasks' | 'instructors', value: string) => {
    const item = value.trim();
    if (item) setFormData(prev => prev[field].includes(item) ? prev : { ...prev, [field]: [...prev[field], item] });
  };

  const removeFromArray = (field: 'foodSlots' | 'tasks' | 'instructors', value: string) => {
    setFormData(prev => ({ ...prev, [field]: prev[field].filter(item => item !== value) }));
  };

  const [newFoodSlot, setNewFoodSlot] = useState('');
  const [newTask, setNewTask] = useState('');
  const [newInstructor, setNewInstructor] = useState('');

  const showPotluckFields = formData.etypes.includes('potluck');
  const showServiceFields = formData.etypes.some(type => ['service-day', 'cleanup'].includes(type));
  const showWorkshopFields = formData.etypes.includes('workshop') || formData.etypes.includes('skill-swap');
  const showGameFields = formData.etypes.includes('trivia') || formData.etypes.includes('game');
  const showCelebrationFields = formData.etypes.includes('celebration') || formData.etypes.includes('ritual');

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-sm">Additional Details</h4>

      {/* Potluck Fields */}
      {showPotluckFields && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <h5 className="font-medium text-sm flex items-center gap-1">
              🍲 Potluck Details
            </h5>

            <div className="space-y-2">
              <Label>Food Slots</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g., main dish, dessert, drinks"
                  value={newFoodSlot}
                  onChange={(e) => setNewFoodSlot(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addToArray('foodSlots', newFoodSlot);
                      setNewFoodSlot('');
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    addToArray('foodSlots', newFoodSlot);
                    setNewFoodSlot('');
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {formData.foodSlots.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {formData.foodSlots.map((slot, index) => (
                    <Badge key={index} variant="outline" className="gap-1 pr-1">
                      {slot}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto p-0 ml-1 hover:bg-transparent"
                        onClick={() => removeFromArray('foodSlots', slot)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="diet-notes">Diet Notes</Label>
              <Input
                id="diet-notes"
                placeholder="e.g., vegetarian options available"
                value={formData.dietNotes}
                onChange={(e) => setFormData(prev => ({ ...prev, dietNotes: e.target.value }))}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Service/Cleanup Fields */}
      {showServiceFields && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <h5 className="font-medium text-sm flex items-center gap-1">
              🧹 Service Details
            </h5>

            <div className="space-y-2">
              <Label>Tasks</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g., trash pickup, weeding, painting"
                  value={newTask}
                  onChange={(e) => setNewTask(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addToArray('tasks', newTask);
                      setNewTask('');
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    addToArray('tasks', newTask);
                    setNewTask('');
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {formData.tasks.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {formData.tasks.map((task, index) => (
                    <Badge key={index} variant="outline" className="gap-1 pr-1">
                      {task}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto p-0 ml-1 hover:bg-transparent"
                        onClick={() => removeFromArray('tasks', task)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="tools-needed">Tools Needed</Label>
              <Input
                id="tools-needed"
                placeholder="e.g., gloves, rakes, trash bags"
                value={formData.toolsNeeded}
                onChange={(e) => setFormData(prev => ({ ...prev, toolsNeeded: e.target.value }))}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Workshop/Skill-swap Fields */}
      {showWorkshopFields && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <h5 className="font-medium text-sm flex items-center gap-1">
              🛠️ Workshop Details
            </h5>

            <div className="space-y-2">
              <Label>Instructors</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Enter instructor name or npub"
                  value={newInstructor}
                  onChange={(e) => setNewInstructor(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addToArray('instructors', newInstructor);
                      setNewInstructor('');
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    addToArray('instructors', newInstructor);
                    setNewInstructor('');
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {formData.instructors.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {formData.instructors.map((instructor, index) => (
                    <Badge key={index} variant="outline" className="gap-1 pr-1">
                      {instructor}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto p-0 ml-1 hover:bg-transparent"
                        onClick={() => removeFromArray('instructors', instructor)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="materials">Materials</Label>
              <Input
                id="materials"
                placeholder="e.g., laptop required, materials provided"
                value={formData.materials}
                onChange={(e) => setFormData(prev => ({ ...prev, materials: e.target.value }))}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Game/Trivia Fields */}
      {showGameFields && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <h5 className="font-medium text-sm flex items-center gap-1">
              🎮 Game Details
            </h5>

            <div className="space-y-2">
              <Label htmlFor="game-kind">Game Type</Label>
              <Input
                id="game-kind"
                placeholder="e.g., trivia, board games, video games"
                value={formData.gameKind}
                onChange={(e) => setFormData(prev => ({ ...prev, gameKind: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Teams Mode</Label>
              <div className="flex gap-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="teams-auto"
                    checked={formData.teamsMode === 'auto'}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setFormData(prev => ({ ...prev, teamsMode: 'auto' }));
                      }
                    }}
                  />
                  <label htmlFor="teams-auto" className="text-sm cursor-pointer">
                    Auto-assign teams
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="teams-custom"
                    checked={formData.teamsMode === 'custom'}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setFormData(prev => ({ ...prev, teamsMode: 'custom' }));
                      }
                    }}
                  />
                  <label htmlFor="teams-custom" className="text-sm cursor-pointer">
                    Custom teams
                  </label>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Celebration/Ritual Fields */}
      {showCelebrationFields && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <h5 className="font-medium text-sm flex items-center gap-1">
              🎉 Celebration Details
            </h5>

            <div className="space-y-2">
              <Label htmlFor="occasion">Occasion</Label>
              <Input
                id="occasion"
                placeholder="e.g., birthday, harvest, solstice"
                value={formData.occasion}
                onChange={(e) => setFormData(prev => ({ ...prev, occasion: e.target.value }))}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const EMPTY_EVENT_FORM: EventFormData = {
  title: '',
  summary: '',
  description: '',
  place: '',
  image: '',
  date: '',
  time: '',
  duration: '60', // minutes
  etypes: [] as EventType[], // Start with no types selected
  visibility: 'public' as EventVisibility,
  villages: [] as string[],
  invitees: [] as string[],
  privateDetails: '',
  exactLocation: '',
  sendDMs: true,
  enableZaps: false,
  enableComments: true,
  autoPromptStory: true,
  // Type-specific data
  foodSlots: [] as string[],
  dietNotes: '',
  tasks: [] as string[],
  toolsNeeded: '',
  instructors: [] as string[],
  materials: '',
  gameKind: '',
  teamsMode: 'auto' as 'auto' | 'custom',
  occasion: '',
};

export function CreateEventDialog({ children, tribeId }: CreateEventDialogProps) {
  const { user } = useCurrentUser();
  usePublicTribes(); // Keep hook active for potential future use
  const { mutateAsync: createEnhancedEvent, isPending: isCreating } = useCreateEnhancedEvent();
  const { mutateAsync: sendPrivateDetails, isPending: isSendingInvites } = useSendPrivateEventDetails();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);

  const [formData, setFormData] = useState<EventFormData>(EMPTY_EVENT_FORM);
  // Set when the event was published but some invitations didn't go through
  const [invitationRecovery, setInvitationRecovery] = useState<InvitationOutcome | null>(null);
  const { mutateAsync: retryInvitations, isPending: isRetryingInvites } = useRetryInvitations();

  const finish = () => {
    setOpen(false);
    setInvitationRecovery(null);
    setFormData(EMPTY_EVENT_FORM);
  };



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();


    if (!user) {
      toast({
        title: "Error",
        description: "You must be logged in to create an event",
        variant: "destructive",
      });
      return;
    }

    if (!formData.title.trim() || !formData.date || !formData.time || !formData.place.trim()) {
      toast({
        title: "Error",
        description: "Title, date, time, and location are required",
        variant: "destructive",
      });
      return;
    }

    if (formData.etypes.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one event type",
        variant: "destructive",
      });
      return;
    }

    if (formData.visibility === 'private' && formData.invitees.length === 0) {
      toast({
        title: "Error",
        description: "Private events must have at least one invitee",
        variant: "destructive",
      });
      return;
    }

    try {
      // Parse date and time
      const eventDateTime = new Date(`${formData.date}T${formData.time}`);
      const startTimestamp = Math.floor(eventDateTime.getTime() / 1000);

      // Calculate end time if duration is provided
      const durationMinutes = parseInt(formData.duration) || 60;
      const endTimestamp = startTimestamp + (durationMinutes * 60);

      // Use full tribeId for tribe tag (format: pubkey:dTag)
      const tribeSlug = tribeId; // Use full tribeId instead of just dTag

      // Build type-specific data
      const typeSpecificData: Record<string, string | string[]> = {};

      // Potluck data
      if (formData.etypes.includes('potluck')) {
        if (formData.foodSlots.length > 0) {
          formData.foodSlots.forEach(slot => {
            if (!typeSpecificData.food) typeSpecificData.food = [];
            (typeSpecificData.food as string[]).push(slot);
          });
        }
        if (formData.dietNotes.trim()) {
          typeSpecificData.diet_notes = formData.dietNotes.trim();
        }
      }

      // Service/cleanup data
      if (formData.etypes.some(type => ['service-day', 'cleanup'].includes(type))) {
        if (formData.tasks.length > 0) {
          formData.tasks.forEach(task => {
            if (!typeSpecificData.task) typeSpecificData.task = [];
            (typeSpecificData.task as string[]).push(task);
          });
        }
        if (formData.toolsNeeded.trim()) {
          typeSpecificData.tools_needed = formData.toolsNeeded.trim();
        }
      }

      // Workshop/skill-swap data
      if (formData.etypes.some(type => ['workshop', 'skill-swap'].includes(type))) {
        if (formData.instructors.length > 0) {
          formData.instructors.forEach(instructor => {
            if (!typeSpecificData.instructors) typeSpecificData.instructors = [];
            (typeSpecificData.instructors as string[]).push(instructor);
          });
        }
        if (formData.materials.trim()) {
          typeSpecificData.materials = formData.materials.trim();
        }
      }

      // Game/trivia data
      if (formData.etypes.some(type => ['trivia', 'game'].includes(type))) {
        if (formData.gameKind.trim()) {
          typeSpecificData.game_kind = formData.gameKind.trim();
        }
        typeSpecificData.teams_mode = formData.teamsMode;
      }

      // Celebration/ritual data
      if (formData.etypes.some(type => ['celebration', 'ritual'].includes(type))) {
        if (formData.occasion.trim()) {
          typeSpecificData.occasion = formData.occasion.trim();
        }
      }

      if (formData.etypes.includes('celebration') && formData.occasion.trim()) {
        typeSpecificData.occasion = formData.occasion.trim();
      }



      // Log the event creation attempt

      // Create the enhanced event
      const result = await createEnhancedEvent({
        tribe: tribeSlug,
        title: formData.title.trim(),
        summary: formData.summary.trim() || undefined,
        content: formData.description.trim(),
        start: startTimestamp,
        end: endTimestamp,
        place: formData.place.trim(),
        image: formData.image || undefined, // Include uploaded image
        etypes: formData.etypes,
        visibility: formData.visibility,
        villages: formData.villages,
        invitees: formData.invitees,
        privateDetails: formData.privateDetails.trim(),
        typeSpecificData,
      });
      if (formData.visibility === 'private' && formData.sendDMs && formData.invitees.length) {
        const outcome = await sendPrivateDetails({
          eventId: result.eventId, eventTitle: formData.title.trim(), invitees: formData.invitees,
          privateDetails: formData.privateDetails.trim() || 'See you there!',
          exactLocation: formData.exactLocation.trim() || formData.place.trim(), organizer: user.pubkey,
        });
        if (!invitationsComplete(outcome)) {
          // Keep the dialog (and the draft) open so only the missing invitations are retried
          setInvitationRecovery(outcome);
          toast({ title: 'Event published', description: 'Some invitations did not go through. You can retry them.', variant: 'destructive' });
          return;
        }
        toast({ title: 'Event published', description: `Private details delivered to all ${outcome.deliveries.length} invitee(s).` });
      } else {
        toast({ title: 'Event published', description: 'Your event has been published.' });
      }
      finish();
    } catch (error) {
      console.error('❌ CATCH BLOCK - Error creating event:', error);
      console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.error('❌ Error type:', typeof error);
      console.error('❌ Error details:', JSON.stringify(error, null, 2));
      toast({
        title: "Error",
        description: `Failed to create event: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
      });
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const [[, url]] = await uploadFile(file);
      setFormData(prev => ({ ...prev, image: url }));
      toast({
        title: "Success",
        description: "Image uploaded successfully",
      });
    } catch (error) {
      console.error('Error uploading image:', error);
      toast({
        title: "Error",
        description: "Failed to upload image",
        variant: "destructive",
      });
    }
  };

  // Get minimum date (today, in the user's own timezone)
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;




  return (
    <Dialog open={open} onOpenChange={(next) => next ? setOpen(true) : (invitationRecovery ? finish() : setOpen(false))}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Event 📅</DialogTitle>
        </DialogHeader>

        {invitationRecovery ? (
          <InvitationRecovery
            outcome={invitationRecovery}
            retrying={isRetryingInvites}
            onClose={finish}
            onRetry={async () => {
              const next = await retryInvitations(invitationRecovery);
              if (invitationsComplete(next)) {
                toast({ title: 'Invitations delivered', description: 'Every invitee now has the private details.' });
                finish();
              } else {
                setInvitationRecovery(next);
              }
            }}
          />
        ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Event Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                placeholder="e.g., Vibe Coders Meetup #3"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="summary">Short Summary</Label>
              <Input
                id="summary"
                value={formData.summary}
                onChange={(e) => setFormData(prev => ({ ...prev, summary: e.target.value }))}
                placeholder="One-line description of your event"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="flex items-center justify-between">
                <span>Description</span>
                <span className={`text-xs ${formData.description.length > 2000 ? 'text-red-500' : formData.description.length > 1800 ? 'text-orange-500' : 'text-muted-foreground'}`}>
                  {formData.description.length}/2000
                </span>
              </Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="What will happen at this event?"
                rows={3}
                maxLength={2000}
              />
              {formData.description.length > 1800 && (
                <p className="text-xs text-orange-600">
                  Warning: Content is close to the 2000 character limit
                </p>
              )}
            </div>
          </div>

          {/* Event Types */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Event Types *</Label>
              <p className="text-sm text-muted-foreground">Select one or more types that describe your event</p>
              <div className="grid grid-cols-2 gap-2">
                {EVENT_TYPES.map((type) => {
                  const { emoji, label } = getEventTypeInfo(type);
                  const isSelected = formData.etypes.includes(type);

                  return (
                    <div key={type} className="flex items-center space-x-2">
                      <Checkbox
                        id={`etype-${type}`}
                        checked={isSelected}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setFormData(prev => ({
                              ...prev,
                              etypes: [...prev.etypes, type]
                            }));
                          } else {
                            setFormData(prev => ({
                              ...prev,
                              etypes: prev.etypes.filter(t => t !== type)
                            }));
                          }
                        }}
                      />
                      <label
                        htmlFor={`etype-${type}`}
                        className="text-sm cursor-pointer flex items-center gap-1"
                      >
                        <span>{emoji}</span>
                        <span>{label}</span>
                      </label>
                    </div>
                  );
                })}
              </div>

              {/* Show selected types as chips */}
              {formData.etypes.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {formData.etypes.map((type) => {
                    const { emoji, label } = getEventTypeInfo(type);
                    return (
                      <Badge
                        key={type}
                        variant="secondary"
                        className="gap-1 pr-1"
                      >
                        <span>{emoji}</span>
                        <span>{label}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0 ml-1 hover:bg-transparent"
                          onClick={() => {
                            setFormData(prev => ({
                              ...prev,
                              etypes: prev.etypes.filter(t => t !== type)
                            }));
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Type-specific fields */}
            {formData.etypes.length > 0 && (
              <>
                <Separator />
                <TypeSpecificFields formData={formData} setFormData={setFormData} />
              </>
            )}
          </div>

          {/* Date & Time */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="date">Date *</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="date"
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                    min={today}
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="time">Time *</Label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="time"
                    type="time"
                    value={formData.time}
                    onChange={(e) => setFormData(prev => ({ ...prev, time: e.target.value }))}
                    className="pl-10"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration">Duration (minutes)</Label>
              <Input
                id="duration"
                type="number"
                value={formData.duration}
                onChange={(e) => setFormData(prev => ({ ...prev, duration: e.target.value }))}
                placeholder="60"
                min="15"
                max="480"
              />
            </div>
          </div>

          {/* Location */}
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={formData.place}
              onChange={(e) => setFormData(prev => ({ ...prev, place: e.target.value }))}
              placeholder="e.g., Tech Hub Downtown, 123 Main St"
            />
          </div>

          {/* Image Upload */}
          <div className="space-y-2">
            <Label>Event Image</Label>
            <div className="space-y-3">
              {formData.image && (
                <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                  <img
                    src={formData.image}
                    alt="Event"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              <Label htmlFor="image-upload" className="cursor-pointer">
                <Card className="border-dashed border-2 hover:border-primary/50 transition-colors">
                  <CardContent className="py-4 px-6 text-center">
                    {isUploading ? (
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Uploading...</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2">
                        <Upload className="h-4 w-4" />
                        <span className="text-sm">Upload Event Image</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Label>
              <input
                id="image-upload"
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
                disabled={isUploading}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isCreating || isSendingInvites || isUploading}
              className="flex-1"
              onClick={() => console.log('🔘 Create Event button clicked')}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Event'
              )}
            </Button>
          </div>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}