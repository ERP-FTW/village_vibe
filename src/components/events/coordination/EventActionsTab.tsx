import { useState } from "react";
import type { NostrEvent } from "@nostrify/nostrify";
import { ACTION_STATUSES, useEventActions, useUpdateAction, type ActionStatus, type EventAction } from "@/hooks/useEventCoordination";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useToast } from "@/hooks/useToast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus, ListChecks } from "lucide-react";
import { CreateActionDialog } from "./CreateActionDialog";

interface EventActionsTabProps {
  event: NostrEvent;
  canManage: boolean;
}

/** Status picker for people allowed to update a task: managers, its creator and its assignee. */
function TaskStatusControl({ event, action }: { event: NostrEvent; action: EventAction }) {
  const { mutate: updateAction, isPending } = useUpdateAction();
  const { toast } = useToast();
  const dTag = event.tags.find(([n]) => n === 'd')?.[1] ?? '';
  return (
    <Select
      value={action.status}
      disabled={isPending}
      onValueChange={(status) => updateAction({
        actionId: action.id,
        actionEventId: action.nostrId,
        eventId: event.id,
        eventKind: event.kind,
        eventAuthor: event.pubkey,
        eventDTag: dTag,
        status: status as ActionStatus,
      }, {
        onError: (err) => toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Failed to update the task",
          variant: "destructive",
        }),
      })}
    >
      <SelectTrigger className="h-8 w-36" aria-label={`Status of ${action.title}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ACTION_STATUSES.map(status => (
          <SelectItem key={status} value={status}>{status}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function EventActionsTab({ event, canManage }: EventActionsTabProps) {
  const { user } = useCurrentUser();
  const { data: actions, isLoading } = useEventActions(event);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'done': return 'bg-green-500/10 text-green-500';
      case 'in-progress': return 'bg-blue-500/10 text-blue-500';
      case 'blocked': return 'bg-red-500/10 text-red-500';
      default: return 'bg-gray-500/10 text-gray-500';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Tasks & Actions</h2>
          <p className="text-sm text-muted-foreground">
            Track progress on event preparation
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Task
          </Button>
        )}
      </div>

      {!actions || actions.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <ListChecks className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="font-semibold mb-2">No Tasks Yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {canManage
                ? "Add tasks to track event preparation"
                : "No tasks have been added yet"}
            </p>
            {canManage && (
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add First Task
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {actions.map(action => (
            <Card key={action.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold">{action.title}</h3>
                      <Badge className={getStatusColor(action.status)}>
                        {action.status}
                      </Badge>
                      {action.priority && action.priority !== 'medium' && (
                        <Badge variant="outline">{action.priority}</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{action.description}</p>
                    {action.dueDate && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Due: {new Date(action.dueDate * 1000).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  {user && (canManage || action.createdBy === user.pubkey || action.assignedTo === user.pubkey) && (
                    <TaskStatusControl event={event} action={action} />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {canManage && (
        <CreateActionDialog
          event={event}
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
        />
      )}
    </div>
  );
}
