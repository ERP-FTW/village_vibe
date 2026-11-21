import { useNostrPublish } from './useNostrPublish';
import { useCurrentUser } from './useCurrentUser';
import { useNostr } from '@nostrify/react';
import { useQuery, useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useTribe } from './useTribes';
import { tribeMembers, tribeModerators } from '@/lib/tribes';
import { useCallback, useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Event Coordination System
 *
 * This module provides a flexible system for coordinating people, stuff, and tasks
 * for any type of event using composable sub-objects:
 *
 * - Roles: People responsibilities or shifts
 * - Items: Physical or digital resources to bring/provide
 * - Actions: Discrete tasks or milestones to complete
 * - Outcomes: Metrics or stories that record results
 * - Alerts: Timed or conditional notifications
 */

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

export const ROLE_STATUSES = ['open', 'claimed', 'filled', 'canceled'] as const;
export type RoleStatus = typeof ROLE_STATUSES[number];

export const ITEM_STATUSES = ['needed', 'claimed', 'confirmed', 'canceled'] as const;
export type ItemStatus = typeof ITEM_STATUSES[number];

export const ACTION_STATUSES = ['pending', 'in-progress', 'done', 'blocked', 'canceled'] as const;
export type ActionStatus = typeof ACTION_STATUSES[number];

export const OUTCOME_TYPES = ['metric', 'story', 'photo', 'feedback'] as const;
export type OutcomeType = typeof OUTCOME_TYPES[number];

export const ALERT_TYPES = ['reminder', 'gap', 'milestone', 'custom'] as const;
export type AlertType = typeof ALERT_TYPES[number];

// Nostr event kinds for coordination objects
export const COORDINATION_KINDS = {
  ROLE: 38401,          // Event role definition
  ROLE_CLAIM: 38402,    // Role claim by user
  ITEM: 38403,          // Event item/resource
  ITEM_CLAIM: 38404,    // Item claim by user
  ACTION: 38405,        // Event action/task
  ACTION_UPDATE: 38406, // Action status update
  OUTCOME: 38407,       // Event outcome record
  ALERT_RULE: 38408,    // Alert rule definition
  ALERT_TRIGGER: 38409, // Alert trigger notification
} as const;

const ALL_COORDINATION_KINDS = [
  COORDINATION_KINDS.ROLE,
  COORDINATION_KINDS.ROLE_CLAIM,
  COORDINATION_KINDS.ITEM,
  COORDINATION_KINDS.ITEM_CLAIM,
  COORDINATION_KINDS.ACTION,
  COORDINATION_KINDS.ACTION_UPDATE,
  COORDINATION_KINDS.OUTCOME,
];

// ============================================================================
// ROLES
// ============================================================================

export interface EventRole {
  id: string;
  /** Nostr id of the definition event (for `e` reply references). */
  nostrId: string;
  eventId: string;
  title: string;
  description: string;
  slots: number;          // How many people needed
  filled: number;         // How many slots filled
  status: RoleStatus;
  timeStart?: number;     // Unix timestamp for shift start
  timeEnd?: number;       // Unix timestamp for shift end
  requirements?: string;  // Special requirements/skills
  externalRef?: string;   // Reference ID for external systems
  createdAt: number;
  createdBy: string;
}

export interface RoleClaim {
  id: string;
  roleId: string;
  eventId: string;
  claimedBy: string;
  claimedAt: number;
  status: 'active' | 'withdrawn';
  notes?: string;
}

// Create a role for an event
export function useCreateRole() {
  const queryClient = useQueryClient();
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: {
      eventId: string;
      eventKind: number;
      eventAuthor: string;
      eventDTag: string;
      title: string;
      description: string;
      slots: number;
      timeStart?: number;
      timeEnd?: number;
      requirements?: string;
      externalRef?: string;
    }) => {
      const roleId = `role-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const tags: string[][] = [
        ['d', roleId],
        ['a', `${data.eventKind}:${data.eventAuthor}:${data.eventDTag}`],
        ['e', data.eventId, '', 'root'],
        ['title', data.title],
        ['slots', data.slots.toString()],
        ['status', 'open'],
        ['alt', `Event role: ${data.title}`],
      ];

      if (data.timeStart) tags.push(['time_start', data.timeStart.toString()]);
      if (data.timeEnd) tags.push(['time_end', data.timeEnd.toString()]);
      if (data.requirements) tags.push(['requirements', data.requirements]);
      if (data.externalRef) tags.push(['external_ref', data.externalRef]);

      const eventData = {
        kind: COORDINATION_KINDS.ROLE,
        content: data.description,
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };

      await publish(eventData);
      return { eventData, roleId };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['event-coordination', variables.eventId],
      });
    },
  });
}

// Claim a role
export function useClaimRole() {
  const queryClient = useQueryClient();
  const { mutateAsync: publish } = useNostrPublish();
  const { user } = useCurrentUser();
  return useMutation({
    mutationFn: async (data: {
      roleId: string;
      roleEventId: string;
      eventId: string;
      eventKind: number;
      eventAuthor: string;
      eventDTag: string;
      notes?: string;
      /** 'withdrawn' replaces the user's claim with a withdrawal. */
      status?: 'active' | 'withdrawn';
    }) => {
      if (!user) throw new Error('You must be logged in');
      // One claim per person per role: republishing replaces it (claim, update or withdraw).
      const claimId = `claim-${data.roleId}-${user.pubkey}`;

      const tags: string[][] = [
        ['d', claimId],
        ['a', `${data.eventKind}:${data.eventAuthor}:${data.eventDTag}`],
        ['e', data.roleEventId, '', 'reply'],
        ['e', data.eventId, '', 'root'],
        ['role', data.roleId],
        ['status', data.status ?? 'active'],
        ['alt', 'Event role claim'],
      ];

      if (data.notes) tags.push(['notes', data.notes]);

      const eventData = {
        kind: COORDINATION_KINDS.ROLE_CLAIM,
        content: data.notes || '',
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };

      await publish(eventData);
      return { eventData, claimId };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['event-coordination', variables.eventId],
      });
    },
  });
}

// ============================================================================
// ITEMS
// ============================================================================

export interface EventItem {
  id: string;
  /** Nostr id of the definition event (for `e` reply references). */
  nostrId: string;
  eventId: string;
  title: string;
  description: string;
  quantity: number;
  claimed: number;
  status: ItemStatus;
  category?: string;      // e.g., "food", "tools", "supplies"
  unit?: string;          // e.g., "servings", "pieces", "hours"
  externalRef?: string;
  createdAt: number;
  createdBy: string;
}

export interface ItemClaim {
  id: string;
  itemId: string;
  eventId: string;
  claimedBy: string;
  quantity: number;
  claimedAt: number;
  status: 'active' | 'withdrawn';
  notes?: string;
}

// Create an item for an event
export function useCreateItem() {
  const queryClient = useQueryClient();
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: {
      eventId: string;
      eventKind: number;
      eventAuthor: string;
      eventDTag: string;
      title: string;
      description: string;
      quantity: number;
      category?: string;
      unit?: string;
      externalRef?: string;
    }) => {
      const itemId = `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const tags: string[][] = [
        ['d', itemId],
        ['a', `${data.eventKind}:${data.eventAuthor}:${data.eventDTag}`],
        ['e', data.eventId, '', 'root'],
        ['title', data.title],
        ['quantity', data.quantity.toString()],
        ['status', 'needed'],
        ['alt', `Event item: ${data.title}`],
      ];

      if (data.category) tags.push(['category', data.category]);
      if (data.unit) tags.push(['unit', data.unit]);
      if (data.externalRef) tags.push(['external_ref', data.externalRef]);

      const eventData = {
        kind: COORDINATION_KINDS.ITEM,
        content: data.description,
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };

      await publish(eventData);
      return { eventData, itemId };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['event-coordination', variables.eventId],
      });
    },
  });
}

// Claim an item
export function useClaimItem() {
  const queryClient = useQueryClient();
  const { mutateAsync: publish } = useNostrPublish();
  const { user } = useCurrentUser();
  return useMutation({
    mutationFn: async (data: {
      itemId: string;
      itemEventId: string;
      eventId: string;
      eventKind: number;
      eventAuthor: string;
      eventDTag: string;
      quantity: number;
      notes?: string;
      /** 'withdrawn' replaces the user's claim with a withdrawal. */
      status?: 'active' | 'withdrawn';
    }) => {
      if (!user) throw new Error('You must be logged in');
      // One claim per person per item: republishing replaces it (claim, update or withdraw).
      const claimId = itemClaimId(data.itemId, user.pubkey);

      const tags: string[][] = [
        ['d', claimId],
        ['a', `${data.eventKind}:${data.eventAuthor}:${data.eventDTag}`],
        ['e', data.itemEventId, '', 'reply'],
        ['e', data.eventId, '', 'root'],
        ['item', data.itemId],
        ['quantity', data.quantity.toString()],
        ['status', data.status ?? 'active'],
        ['alt', 'Event item claim'],
      ];

      if (data.notes) tags.push(['notes', data.notes]);

      const eventData = {
        kind: COORDINATION_KINDS.ITEM_CLAIM,
        content: data.notes || '',
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };

      await publish(eventData);
      return { eventData, claimId };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['event-coordination', variables.eventId],
      });
    },
  });
}

// ============================================================================
// ACTIONS
// ============================================================================

export interface EventAction {
  id: string;
  /** Nostr id of the definition event (for `e` reply references). */
  nostrId: string;
  eventId: string;
  title: string;
  description: string;
  status: ActionStatus;
  assignedTo?: string;
  dueDate?: number;
  completedAt?: number;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  dependencies?: string[]; // Other action IDs that must complete first
  externalRef?: string;
  createdAt: number;
  createdBy: string;
}

export interface ActionUpdate {
  id: string;
  actionId: string;
  eventId: string;
  status: ActionStatus;
  updatedBy: string;
  updatedAt: number;
  notes?: string;
}

// Create an action for an event
export function useCreateAction() {
  const queryClient = useQueryClient();
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: {
      eventId: string;
      eventKind: number;
      eventAuthor: string;
      eventDTag: string;
      title: string;
      description: string;
      assignedTo?: string;
      dueDate?: number;
      priority?: 'low' | 'medium' | 'high' | 'urgent';
      dependencies?: string[];
      externalRef?: string;
    }) => {
      const actionId = `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const tags: string[][] = [
        ['d', actionId],
        ['a', `${data.eventKind}:${data.eventAuthor}:${data.eventDTag}`],
        ['e', data.eventId, '', 'root'],
        ['title', data.title],
        ['status', 'pending'],
        ['alt', `Event action: ${data.title}`],
      ];

      if (data.assignedTo) tags.push(['p', data.assignedTo, '', 'assigned']);
      if (data.dueDate) tags.push(['due_date', data.dueDate.toString()]);
      if (data.priority) tags.push(['priority', data.priority]);
      if (data.dependencies) {
        data.dependencies.forEach(dep => tags.push(['depends', dep]));
      }
      if (data.externalRef) tags.push(['external_ref', data.externalRef]);

      const eventData = {
        kind: COORDINATION_KINDS.ACTION,
        content: data.description,
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };

      await publish(eventData);
      return { eventData, actionId };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['event-coordination', variables.eventId],
      });
    },
  });
}

// Update action status
export function useUpdateAction() {
  const queryClient = useQueryClient();
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: {
      actionId: string;
      actionEventId: string;
      eventId: string;
      eventKind: number;
      eventAuthor: string;
      eventDTag: string;
      status: ActionStatus;
      notes?: string;
    }) => {
      const updateId = `update-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const tags: string[][] = [
        ['d', updateId],
        ['a', `${data.eventKind}:${data.eventAuthor}:${data.eventDTag}`],
        ['e', data.actionEventId, '', 'reply'],
        ['e', data.eventId, '', 'root'],
        ['action', data.actionId],
        ['status', data.status],
        ['alt', 'Action status update'],
      ];

      if (data.notes) tags.push(['notes', data.notes]);

      const eventData = {
        kind: COORDINATION_KINDS.ACTION_UPDATE,
        content: data.notes || `Status changed to ${data.status}`,
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };

      await publish(eventData);
      return { eventData, updateId };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['event-coordination', variables.eventId],
      });
    },
  });
}

// ============================================================================
// OUTCOMES
// ============================================================================

export interface EventOutcome {
  id: string;
  eventId: string;
  type: OutcomeType;
  title: string;
  content: string;
  value?: number;        // For metrics
  unit?: string;         // For metrics
  mediaUrl?: string;     // For photos
  externalRef?: string;
  createdAt: number;
  createdBy: string;
}

// Create an outcome for an event
export function useCreateOutcome() {
  const queryClient = useQueryClient();
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: {
      eventId: string;
      eventKind: number;
      eventAuthor: string;
      eventDTag: string;
      type: OutcomeType;
      title: string;
      content: string;
      value?: number;
      unit?: string;
      mediaUrl?: string;
      externalRef?: string;
    }) => {
      const outcomeId = `outcome-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const tags: string[][] = [
        ['d', outcomeId],
        ['a', `${data.eventKind}:${data.eventAuthor}:${data.eventDTag}`],
        ['e', data.eventId, '', 'root'],
        ['type', data.type],
        ['title', data.title],
        ['alt', `Event outcome: ${data.title}`],
      ];

      if (data.value !== undefined) tags.push(['value', data.value.toString()]);
      if (data.unit) tags.push(['unit', data.unit]);
      if (data.mediaUrl) tags.push(['media', data.mediaUrl]);
      if (data.externalRef) tags.push(['external_ref', data.externalRef]);

      const eventData = {
        kind: COORDINATION_KINDS.OUTCOME,
        content: data.content,
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };

      await publish(eventData);
      return { eventData, outcomeId };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['event-coordination', variables.eventId],
      });
    },
  });
}

// ============================================================================
// BATCHED DATA FETCH
// ============================================================================

export interface EventCoordinationData {
  roles: EventRole[];
  roleClaims: RoleClaim[];
  items: EventItem[];
  itemClaims: ItemClaim[];
  actions: EventAction[];
  actionUpdates: ActionUpdate[];
  outcomes: EventOutcome[];
}

/** Parsed coordination records before trust filtering and counting. */
interface RawCoordination {
  roles: EventRole[];
  roleClaims: RoleClaim[];
  items: EventItem[];
  itemClaims: ItemClaim[];
  actions: EventAction[];
  actionUpdates: ActionUpdate[];
  outcomes: EventOutcome[];
}

/** Latest record per key (by timestamp). */
function latestBy<T>(records: T[], key: (record: T) => string, time: (record: T) => number): T[] {
  const latest = new Map<string, T>();
  for (const record of records) {
    const k = key(record);
    const current = latest.get(k);
    if (!current || time(record) > time(current)) latest.set(k, record);
  }
  return [...latest.values()];
}

/** The canonical d-tag of a person's claim on an item; republishing it replaces the claim. */
export function itemClaimId(itemId: string, pubkey: string): string {
  return `claim-${itemId}-${pubkey}`;
}

/**
 * Each person's current claims per item. A canonical claim (`claim-<item>-<pubkey>`) holds
 * the person's running total and supersedes everything else they published for that item.
 * Older clients published a new claim per submission carrying only the added quantity, so
 * until a canonical claim exists those legacy claims are all kept and their quantities add up.
 */
function currentItemClaims(claims: ItemClaim[]): ItemClaim[] {
  const byPerson = new Map<string, ItemClaim[]>();
  for (const claim of latestBy(claims, c => `${c.claimedBy}:${c.id}`, c => c.claimedAt)) {
    const key = `${claim.itemId}:${claim.claimedBy}`;
    byPerson.set(key, [...(byPerson.get(key) ?? []), claim]);
  }
  return [...byPerson.values()].flatMap(group => {
    const canonical = group.find(c => c.id === itemClaimId(c.itemId, c.claimedBy));
    return canonical ? [canonical] : group;
  });
}

/**
 * Apply trust and counting rules (pure, used as the query's `select`):
 * - roles, items, actions and outcomes count only when created by a trusted author
 *   (the event organizer or a moderator of its tribe);
 * - each person's latest claim per role wins (claims can be withdrawn); per item, the
 *   person's canonical claim is their total, else their legacy incremental claims add up;
 *   only claims on trusted roles/items count; fills count distinct people;
 * - task status updates count only from trusted authors, the task's creator or
 *   its assignee, newest first.
 */
export function deriveCoordination(raw: RawCoordination, trusted: ReadonlySet<string>): EventCoordinationData {
  const roles = raw.roles.filter(r => trusted.has(r.createdBy));
  const items = raw.items.filter(i => trusted.has(i.createdBy));
  const actions = raw.actions.filter(a => trusted.has(a.createdBy));
  const outcomes = raw.outcomes.filter(o => trusted.has(o.createdBy));

  const roleIds = new Set(roles.map(r => r.id));
  const itemIds = new Set(items.map(i => i.id));
  const roleClaims = latestBy(raw.roleClaims.filter(c => roleIds.has(c.roleId)), c => `${c.roleId}:${c.claimedBy}`, c => c.claimedAt);
  const itemClaims = currentItemClaims(raw.itemClaims.filter(c => itemIds.has(c.itemId)));

  const roleFilled = new Map<string, number>();
  roleClaims.filter(c => c.status === 'active').forEach(c => roleFilled.set(c.roleId, (roleFilled.get(c.roleId) ?? 0) + 1));
  const itemClaimed = new Map<string, number>();
  itemClaims.filter(c => c.status === 'active' && c.quantity > 0)
    .forEach(c => itemClaimed.set(c.itemId, (itemClaimed.get(c.itemId) ?? 0) + c.quantity));

  const actionById = new Map(actions.map(a => [a.id, a]));
  const actionUpdates = raw.actionUpdates.filter(u => {
    const action = actionById.get(u.actionId);
    return !!action && (trusted.has(u.updatedBy) || u.updatedBy === action.createdBy || u.updatedBy === action.assignedTo);
  });
  const latestStatus = new Map(latestBy(actionUpdates, u => u.actionId, u => u.updatedAt).map(u => [u.actionId, u.status]));

  return {
    roles: roles.map(r => ({ ...r, filled: roleFilled.get(r.id) ?? 0 })),
    roleClaims,
    items: items.map(i => ({ ...i, claimed: itemClaimed.get(i.id) ?? 0 })),
    itemClaims,
    actions: actions.map(a => ({ ...a, status: latestStatus.get(a.id) ?? a.status })),
    actionUpdates,
    outcomes,
  };
}

/**
 * Fetch ALL coordination data for an event in a single relay request.
 *
 * Primary filter: stable `a` tag coordinate (survives event updates).
 * Fallback filter: `e` tag (for records written before the `a` tag was used).
 *
 * Trust rules are applied in `select` (see deriveCoordination), so learning the tribe's
 * moderators later re-derives the view without refetching.
 */
export function useEventCoordinationData(event: NostrEvent): UseQueryResult<EventCoordinationData> {
  const { nostr } = useNostr();
  const trusted = useCoordinationTrust(event);

  const dTag = event.tags.find(([n]) => n === 'd')?.[1] ?? '';
  const eventAddress = `${event.kind}:${event.pubkey}:${dTag}`;

  const select = useCallback((raw: RawCoordination) => deriveCoordination(raw, trusted), [trusted]);

  return useQuery({
    queryKey: ['event-coordination', event.id, eventAddress],
    select,
    queryFn: async (c): Promise<RawCoordination> => {
      const raw = await nostr.query(
        [
          // Primary: stable addressable coordinate (works across revisions)
          { kinds: ALL_COORDINATION_KINDS, '#a': [eventAddress], limit: 500 },
          // Fallback: legacy records that only carried an `e` tag
          { kinds: ALL_COORDINATION_KINDS, '#e': [event.id], limit: 500 },
        ],
        { signal: c.signal },
      );

      const ofKind = (kind: number) => raw.filter(e => e.kind === kind);
      return {
        roles: ofKind(COORDINATION_KINDS.ROLE).map(parseRoleEvent).filter((r): r is EventRole => r !== null),
        roleClaims: ofKind(COORDINATION_KINDS.ROLE_CLAIM).map(parseRoleClaimEvent).filter((x): x is RoleClaim => x !== null),
        items: ofKind(COORDINATION_KINDS.ITEM).map(parseItemEvent).filter((i): i is EventItem => i !== null),
        itemClaims: ofKind(COORDINATION_KINDS.ITEM_CLAIM).map(parseItemClaimEvent).filter((x): x is ItemClaim => x !== null),
        actions: ofKind(COORDINATION_KINDS.ACTION).map(parseActionEvent).filter((a): a is EventAction => a !== null),
        actionUpdates: ofKind(COORDINATION_KINDS.ACTION_UPDATE).map(parseActionUpdateEvent).filter((u): u is ActionUpdate => u !== null),
        outcomes: ofKind(COORDINATION_KINDS.OUTCOME).map(parseOutcomeEvent).filter((o): o is EventOutcome => o !== null),
      };
    },
  });
}

/**
 * Authors trusted to define an event's roles, items, tasks and outcomes: the organizer,
 * plus the moderators of the event's tribe when that tribe is identified by an
 * author-qualified `a` coordinate (34550:<owner>:<d>) and the organizer is a member.
 * A bare `tribe` d tag is ambiguous (anyone can publish a look-alike tribe), so it never
 * grants moderator trust.
 */
export function useCoordinationTrust(event: NostrEvent): ReadonlySet<string> {
  const coordinate = event.tags.find(([n, v]) => n === 'a' && v?.startsWith('34550:'))?.[1];
  const tribeId = coordinate ? coordinate.slice('34550:'.length) : '';
  const { data: tribe } = useTribe(tribeId);
  const moderatorsKey = tribe && tribeMembers(tribe).has(event.pubkey)
    ? tribeModerators(tribe).sort().join(',')
    : '';
  return useMemo(
    () => new Set([event.pubkey, ...(moderatorsKey ? moderatorsKey.split(',') : [])]),
    [event.pubkey, moderatorsKey],
  );
}

// ============================================================================
// SUMMARY / AGGREGATION
// ============================================================================

export interface EventCoordinationSummary {
  eventId: string;
  roles: {
    total: number;
    open: number;
    filled: number;
    items: EventRole[];
  };
  items: {
    total: number;
    needed: number;
    claimed: number;
    items: EventItem[];
  };
  actions: {
    total: number;
    pending: number;
    inProgress: number;
    done: number;
    blocked: number;
    items: EventAction[];
  };
  outcomes: {
    total: number;
    items: EventOutcome[];
  };
}

/** Pure function — safe to call inside useMemo */
export function buildCoordinationSummary(
  eventId: string,
  data: EventCoordinationData,
): EventCoordinationSummary {
  const { roles, items, actions, outcomes } = data;

  return {
    eventId,
    roles: {
      total: roles.length,
      open: roles.filter(r => r.filled < r.slots).length,
      filled: roles.filter(r => r.filled >= r.slots).length,
      items: roles,
    },
    items: {
      total: items.length,
      needed: items.filter(i => i.claimed < i.quantity).length,
      claimed: items.filter(i => i.claimed >= i.quantity).length,
      items,
    },
    actions: {
      total: actions.length,
      pending: actions.filter(a => a.status === 'pending').length,
      inProgress: actions.filter(a => a.status === 'in-progress').length,
      done: actions.filter(a => a.status === 'done').length,
      blocked: actions.filter(a => a.status === 'blocked').length,
      items: actions,
    },
    outcomes: {
      total: outcomes.length,
      items: outcomes,
    },
  };
}

/**
 * Convenience hook that returns the coordination data AND a memoized summary.
 * Replaces the old useEventCoordinationSummary + four separate hooks pattern.
 */
export function useEventCoordinationSummary(event: NostrEvent) {
  const query = useEventCoordinationData(event);

  const summary = useMemo(
    () => (query.data ? buildCoordinationSummary(event.id, query.data) : undefined),
    [event.id, query.data],
  );

  return { ...query, summary };
}

// ============================================================================
// LEGACY SHIM HOOKS (thin wrappers over the batched query for tab components)
// ============================================================================

/** Used by EventActionsTab */
export function useEventActions(event: NostrEvent) {
  const query = useEventCoordinationData(event);
  return { ...query, data: query.data?.actions };
}

/** Used by EventOutcomesTab */
export function useEventOutcomes(event: NostrEvent) {
  const query = useEventCoordinationData(event);
  return { ...query, data: query.data?.outcomes };
}

// ============================================================================
// PARSER FUNCTIONS
// ============================================================================

function parseRoleEvent(event: NostrEvent): EventRole | null {
  const dTag = event.tags.find(([n]) => n === 'd')?.[1];
  const eTag = event.tags.find(([n]) => n === 'e')?.[1];
  const title = event.tags.find(([n]) => n === 'title')?.[1];
  const slots = event.tags.find(([n]) => n === 'slots')?.[1];
  const status = event.tags.find(([n]) => n === 'status')?.[1] as RoleStatus;

  if (!dTag || !eTag || !title || !slots) return null;

  return {
    id: dTag,
    nostrId: event.id,
    eventId: eTag,
    title,
    description: event.content,
    slots: parseInt(slots),
    filled: 0, // Will be merged by the batched hook
    status: status || 'open',
    timeStart: event.tags.find(([n]) => n === 'time_start')?.[1]
      ? parseInt(event.tags.find(([n]) => n === 'time_start')![1])
      : undefined,
    timeEnd: event.tags.find(([n]) => n === 'time_end')?.[1]
      ? parseInt(event.tags.find(([n]) => n === 'time_end')![1])
      : undefined,
    requirements: event.tags.find(([n]) => n === 'requirements')?.[1],
    externalRef: event.tags.find(([n]) => n === 'external_ref')?.[1],
    createdAt: event.created_at,
    createdBy: event.pubkey,
  };
}

function parseRoleClaimEvent(event: NostrEvent): RoleClaim | null {
  const dTag = event.tags.find(([n]) => n === 'd')?.[1];
  const roleId = event.tags.find(([n]) => n === 'role')?.[1];
  const eventId = event.tags.find(([n, , , marker]) => n === 'e' && marker === 'root')?.[1];
  const status = event.tags.find(([n]) => n === 'status')?.[1] as 'active' | 'withdrawn';

  if (!dTag || !roleId || !eventId) return null;

  return {
    id: dTag,
    roleId,
    eventId,
    claimedBy: event.pubkey,
    claimedAt: event.created_at,
    status: status || 'active',
    notes: event.tags.find(([n]) => n === 'notes')?.[1] || event.content,
  };
}

function parseItemEvent(event: NostrEvent): EventItem | null {
  const dTag = event.tags.find(([n]) => n === 'd')?.[1];
  const eTag = event.tags.find(([n]) => n === 'e')?.[1];
  const title = event.tags.find(([n]) => n === 'title')?.[1];
  const quantity = event.tags.find(([n]) => n === 'quantity')?.[1];
  const status = event.tags.find(([n]) => n === 'status')?.[1] as ItemStatus;

  if (!dTag || !eTag || !title || !quantity) return null;

  return {
    id: dTag,
    nostrId: event.id,
    eventId: eTag,
    title,
    description: event.content,
    quantity: parseInt(quantity),
    claimed: 0, // Will be merged by the batched hook
    status: status || 'needed',
    category: event.tags.find(([n]) => n === 'category')?.[1],
    unit: event.tags.find(([n]) => n === 'unit')?.[1],
    externalRef: event.tags.find(([n]) => n === 'external_ref')?.[1],
    createdAt: event.created_at,
    createdBy: event.pubkey,
  };
}

function parseItemClaimEvent(event: NostrEvent): ItemClaim | null {
  const dTag = event.tags.find(([n]) => n === 'd')?.[1];
  const itemId = event.tags.find(([n]) => n === 'item')?.[1];
  const eventId = event.tags.find(([n, , , marker]) => n === 'e' && marker === 'root')?.[1];
  const quantity = event.tags.find(([n]) => n === 'quantity')?.[1];
  const status = event.tags.find(([n]) => n === 'status')?.[1] as 'active' | 'withdrawn';

  if (!dTag || !itemId || !eventId || !quantity) return null;

  return {
    id: dTag,
    itemId,
    eventId,
    claimedBy: event.pubkey,
    quantity: parseInt(quantity),
    claimedAt: event.created_at,
    status: status || 'active',
    notes: event.tags.find(([n]) => n === 'notes')?.[1] || event.content,
  };
}

function parseActionEvent(event: NostrEvent): EventAction | null {
  const dTag = event.tags.find(([n]) => n === 'd')?.[1];
  const eTag = event.tags.find(([n]) => n === 'e')?.[1];
  const title = event.tags.find(([n]) => n === 'title')?.[1];
  const status = event.tags.find(([n]) => n === 'status')?.[1] as ActionStatus;

  if (!dTag || !eTag || !title) return null;

  return {
    id: dTag,
    nostrId: event.id,
    eventId: eTag,
    title,
    description: event.content,
    status: status || 'pending',
    assignedTo: event.tags.find(([n, , , marker]) => n === 'p' && marker === 'assigned')?.[1],
    dueDate: event.tags.find(([n]) => n === 'due_date')?.[1]
      ? parseInt(event.tags.find(([n]) => n === 'due_date')![1])
      : undefined,
    priority: event.tags.find(([n]) => n === 'priority')?.[1] as 'low' | 'medium' | 'high' | 'urgent' | undefined,
    dependencies: event.tags.filter(([n]) => n === 'depends').map(([, v]) => v),
    externalRef: event.tags.find(([n]) => n === 'external_ref')?.[1],
    createdAt: event.created_at,
    createdBy: event.pubkey,
  };
}

function parseActionUpdateEvent(event: NostrEvent): ActionUpdate | null {
  const dTag = event.tags.find(([n]) => n === 'd')?.[1];
  const actionId = event.tags.find(([n]) => n === 'action')?.[1];
  const eventId = event.tags.find(([n, , , marker]) => n === 'e' && marker === 'root')?.[1];
  const status = event.tags.find(([n]) => n === 'status')?.[1] as ActionStatus;

  if (!dTag || !actionId || !eventId || !status) return null;

  return {
    id: dTag,
    actionId,
    eventId,
    status,
    updatedBy: event.pubkey,
    updatedAt: event.created_at,
    notes: event.tags.find(([n]) => n === 'notes')?.[1] || event.content,
  };
}

function parseOutcomeEvent(event: NostrEvent): EventOutcome | null {
  const dTag = event.tags.find(([n]) => n === 'd')?.[1];
  const eTag = event.tags.find(([n]) => n === 'e')?.[1];
  const type = event.tags.find(([n]) => n === 'type')?.[1] as OutcomeType;
  const title = event.tags.find(([n]) => n === 'title')?.[1];

  if (!dTag || !eTag || !type || !title) return null;

  return {
    id: dTag,
    eventId: eTag,
    type,
    title,
    content: event.content,
    value: event.tags.find(([n]) => n === 'value')?.[1]
      ? parseFloat(event.tags.find(([n]) => n === 'value')![1])
      : undefined,
    unit: event.tags.find(([n]) => n === 'unit')?.[1],
    mediaUrl: event.tags.find(([n]) => n === 'media')?.[1],
    externalRef: event.tags.find(([n]) => n === 'external_ref')?.[1],
    createdAt: event.created_at,
    createdBy: event.pubkey,
  };
}
