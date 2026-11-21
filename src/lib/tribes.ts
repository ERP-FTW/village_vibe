import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Tribe definitions are NIP-72 community events (kind 34550). Members are `p` tags
 * whose fourth element is a role. Only the creator's key can replace the definition,
 * so every membership or settings change must be signed by `tribe.pubkey`.
 */
export const TRIBE_KIND = 34550;

/** Relays reject very large author lists; tribes beyond this size need tag-based queries. */
export const MAX_FEED_AUTHORS = 500;

export type TribeRole = 'admin' | 'moderator' | 'event_creator' | 'member';

const ROLE_RANK: Record<TribeRole, number> = { admin: 4, moderator: 3, event_creator: 2, member: 1 };

function asRole(value: string | undefined): TribeRole {
  return value && value in ROLE_RANK ? value as TribeRole : 'member';
}

export function tribeDTag(tribe: NostrEvent): string {
  return tribe.tags.find(([name]) => name === 'd')?.[1] ?? '';
}

export function tribeIdOf(tribe: NostrEvent): string {
  return `${tribe.pubkey}:${tribeDTag(tribe)}`;
}

/** Highest role per member pubkey. The creator is always an admin. */
export function tribeMembers(tribe: NostrEvent): Map<string, TribeRole> {
  const members = new Map<string, TribeRole>();
  for (const [name, pubkey, , role] of tribe.tags) {
    if (name !== 'p' || !pubkey) continue;
    const next = asRole(role);
    const current = members.get(pubkey);
    if (!current || ROLE_RANK[next] > ROLE_RANK[current]) members.set(pubkey, next);
  }
  members.set(tribe.pubkey, 'admin');
  return members;
}

export function tribeRoleOf(tribe: NostrEvent, pubkey: string | undefined): TribeRole | undefined {
  return pubkey ? tribeMembers(tribe).get(pubkey) : undefined;
}

export function isTribeCreator(tribe: NostrEvent, pubkey: string | undefined): boolean {
  return !!pubkey && pubkey === tribe.pubkey;
}

export function isTribeModerator(tribe: NostrEvent, pubkey: string | undefined): boolean {
  const role = tribeRoleOf(tribe, pubkey);
  return role === 'admin' || role === 'moderator';
}

export function canCreateTribeEvents(tribe: NostrEvent, pubkey: string | undefined): boolean {
  const role = tribeRoleOf(tribe, pubkey);
  return role === 'admin' || role === 'moderator' || role === 'event_creator';
}

/** Pubkeys whose events count as tribe events. */
export function tribeEventAuthors(tribe: NostrEvent): string[] {
  return [...tribeMembers(tribe)]
    .filter(([, role]) => role !== 'member')
    .map(([pubkey]) => pubkey);
}

/** Pubkeys whose stories and services count as tribe content. */
export function tribeMemberAuthors(tribe: NostrEvent): string[] {
  return [...tribeMembers(tribe).keys()];
}

/** Pubkeys allowed to moderate the tribe (creator, admins, moderators). */
export function tribeModerators(tribe: NostrEvent): string[] {
  return [...tribeMembers(tribe)]
    .filter(([, role]) => role === 'admin' || role === 'moderator')
    .map(([pubkey]) => pubkey);
}

/**
 * Return `tags` with exactly one `p` tag for `pubkey` carrying `role`, or none when
 * `role` is null. Other tags keep their order.
 */
export function withMemberRole(tags: string[][], pubkey: string, role: TribeRole | null): string[][] {
  const relayHint = tags.find(([name, value]) => name === 'p' && value === pubkey)?.[2] ?? '';
  const rest = tags.filter(([name, value]) => !(name === 'p' && value === pubkey));
  return role ? [...rest, ['p', pubkey, relayHint, role]] : rest;
}

/** Collapse duplicate member `p` tags, keeping each member's highest role. */
export function dedupeMemberTags(tags: string[][]): string[][] {
  const best = new Map<string, string[]>();
  const others: string[][] = [];
  for (const tag of tags) {
    if (tag[0] !== 'p' || !tag[1]) {
      others.push(tag);
      continue;
    }
    const current = best.get(tag[1]);
    if (!current || ROLE_RANK[asRole(tag[3])] > ROLE_RANK[asRole(current[3])]) best.set(tag[1], tag);
  }
  return [...others, ...best.values()];
}

/** Replace (or add) single-valued tags such as `name` or `d`, removing any duplicates. */
export function withSingleTags(tags: string[][], updates: Record<string, string | null>): string[][] {
  const rest = tags.filter(([name]) => !(name in updates));
  const added = Object.entries(updates)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([name, value]) => [name, value]);
  return [...rest, ...added];
}
