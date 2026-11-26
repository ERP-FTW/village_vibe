import { useNostr } from '@nostrify/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useNostrPublish } from './useNostrPublish';
import { useTribe } from './useTribes';
import { belongsToTribe, parseTribeId, tribeCoordinate, tribeLinkTags } from '@/lib/contentTags';
import { dropHidden } from '@/lib/moderation';
import { MODERATION_LABELS } from '@/lib/moderationLabels';
import { tribeMemberAuthors, tribeModerators, withSingleTags } from '@/lib/tribes';

/** NIP-99 classified listing. Tribe goods are ordinary listings linked to the tribe. */
export const GOODS_KIND = 30402;

export const GOODS_STATUSES = ['active', 'sold'] as const;
export type GoodsStatus = typeof GOODS_STATUSES[number];

/** Currencies offered in the create form. Listings from elsewhere may use any code. */
export const GOODS_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'MXN', 'BTC'] as const;

export const GOODS_TITLE_MAX = 100;
export const GOODS_DESCRIPTION_MAX = 2000;

export interface GoodsPrice {
  /** The amount exactly as published (a decimal number in a string). */
  amount: string;
  /** ISO 4217 code, or whatever the listing's author wrote (for example BTC or SATS). */
  currency: string;
  /** Optional recurrence such as "month"; goods normally have none. */
  frequency?: string;
}

export interface GoodsListing {
  id: string;
  pubkey: string;
  dTag: string;
  /** `30402:<pubkey>:<d>`: what questions and labels reference. */
  coordinate: string;
  title: string;
  summary?: string;
  description: string;
  price?: GoodsPrice;
  status: GoodsStatus;
  location?: string;
  image?: string;
  /** Page where the item can be bought, when the seller has one. */
  link?: string;
  publishedAt: number;
}

/** Everything a goods listing publishes. All of it is public on Nostr. */
export interface GoodsListingInput {
  /** `owner:d` tribe id. */
  tribe: string;
  title: string;
  description?: string;
  /** Decimal number as typed, for example "12.50". */
  price: string;
  currency: string;
  /** A general area ("East side", "Saturday market"), never an exact address. */
  location?: string;
  image?: string;
  /** Optional product page. */
  link?: string;
  status?: GoodsStatus;
  /** For updates: the listing's existing identifier and first publication time. */
  dTag?: string;
  publishedAt?: number;
}

const tagValue = (event: NostrEvent, name: string) => event.tags.find(([key]) => key === name)?.[1];

/**
 * An http(s) URL safe to use as a link, else undefined. Pictures must be https: the app's
 * content security policy loads no other images.
 */
export function safeHttpUrl(value: string | undefined, { httpsOnly = false } = {}): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || (url.protocol === 'http:' && !httpsOnly) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** A price tag's amount as a finite, non-negative number, else undefined. */
function parseAmount(value: string | undefined): number | undefined {
  if (!value || !/^\d+(\.\d+)?$/.test(value.trim())) return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : undefined;
}

/** The unsigned kind 30402 event for `data` (pure; every field in it is public). */
export function buildGoodsListingTemplate(data: GoodsListingInput, now = Math.floor(Date.now() / 1000)) {
  const dTag = data.dTag || `goods-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const tags: string[][] = [
    ['d', dTag],
    ['title', data.title.trim()],
    // NIP-99: when the listing first went up; edits keep it
    ['published_at', String(data.publishedAt ?? now)],
    ['price', data.price.trim(), data.currency.trim().toUpperCase()],
    ['status', data.status ?? 'active'],
    // Indexed tribe coordinate plus the legacy d-tag reference
    ...tribeLinkTags(data.tribe),
  ];
  if (data.location?.trim()) tags.push(['location', data.location.trim()]);
  const image = safeHttpUrl(data.image, { httpsOnly: true });
  if (image) tags.push(['image', image]);
  const link = safeHttpUrl(data.link);
  if (link) tags.push(['r', link]);
  return { dTag, template: { kind: GOODS_KIND, content: data.description?.trim() ?? '', tags, created_at: now } };
}

/** Validate a NIP-99 listing well enough to show it as a goods card. */
export function validateGoodsListing(event: NostrEvent): boolean {
  if (event.kind !== GOODS_KIND) return false;
  if (!tagValue(event, 'd') || !tagValue(event, 'title')?.trim()) return false;

  // Expired listings (NIP-40) are no longer shown
  const expiresAt = Number(tagValue(event, 'expiration'));
  if (expiresAt && expiresAt * 1000 < Date.now()) return false;

  // A price is optional in NIP-99. One written in a way this app cannot read is left
  // out of the card (see extractGoodsData) rather than hiding the whole listing.
  return true;
}

/** Read a validated listing into the fields a card shows. */
export function extractGoodsData(event: NostrEvent): GoodsListing {
  const price = event.tags.find(([name]) => name === 'price');
  const dTag = tagValue(event, 'd') ?? '';
  const published = Number(tagValue(event, 'published_at'));
  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    coordinate: `${event.kind}:${event.pubkey}:${dTag}`,
    title: tagValue(event, 'title')?.trim() ?? '',
    summary: tagValue(event, 'summary')?.trim() || undefined,
    description: event.content,
    price: price && parseAmount(price[1]) !== undefined
      ? { amount: price[1].trim(), currency: (price[2] ?? '').trim(), frequency: price[3]?.trim() || undefined }
      : undefined,
    // Anything other than "sold" is treated as available
    status: tagValue(event, 'status') === 'sold' ? 'sold' : 'active',
    location: tagValue(event, 'location')?.trim() || undefined,
    image: safeHttpUrl(tagValue(event, 'image'), { httpsOnly: true }),
    link: safeHttpUrl(tagValue(event, 'r')),
    publishedAt: Number.isFinite(published) && published > 0 ? published : event.created_at,
  };
}

/** "$12.50", "€8", or "21000 SATS" when the currency is not one the browser can format. */
export function formatGoodsPrice(price: GoodsPrice): string {
  const amount = Number(price.amount);
  let text = [price.amount, price.currency].filter(Boolean).join(' ');
  if (/^[A-Za-z]{3}$/.test(price.currency) && price.currency.toUpperCase() !== 'BTC') {
    try {
      text = new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency.toUpperCase() }).format(amount);
    } catch {
      // Not a currency this browser knows: keep the published form
    }
  }
  return price.frequency ? `${text} / ${price.frequency}` : text;
}

/** Goods listed in a tribe by its members, newest first, sold items last. */
export function useTribeGoods(tribeId: string) {
  const { nostr } = useNostr();
  // Feed authors come from the tribe's member list: refetch whenever that definition changes.
  const tribeQuery = useTribe(tribeId);
  const tribeVersion = tribeQuery.data?.id ?? null;

  return useQuery({
    queryKey: ['tribe-goods', tribeId, tribeVersion],
    staleTime: 30000,
    enabled: tribeQuery.isFetched,
    queryFn: async ({ signal }) => {
      const parsed = parseTribeId(tribeId);
      if (!parsed) return [];

      // Any member can list an item in their tribe (the same rule as services).
      const tribe = tribeQuery.data ?? null;
      const allowed = new Set(tribe ? tribeMemberAuthors(tribe) : [parsed.pubkey]);
      const moderators = tribe ? tribeModerators(tribe) : [parsed.pubkey];
      const records = await dropHidden(nostr, await nostr.query([
        { kinds: [GOODS_KIND], '#a': [tribeCoordinate(tribeId)], limit: 200 },
      ], { signal }), moderators, signal);

      return records
        .filter(event => allowed.has(event.pubkey) && belongsToTribe(event.tags, tribeId) && validateGoodsListing(event))
        .sort((a, b) => {
          const sold = Number(tagValue(a, 'status') === 'sold') - Number(tagValue(b, 'status') === 'sold');
          return sold || b.created_at - a.created_at;
        });
    },
  });
}

/** Publish a new goods listing, or replace one when `dTag` is given. */
export function useCreateGoodsListing() {
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async (data: GoodsListingInput) => {
      const { dTag, template } = buildGoodsListingTemplate(data);
      const published = await publish(template);
      return { dTag, event: published };
    },
  });
}

/** The seller marks their own listing sold or available again; every other tag is kept. */
export function useSetGoodsStatus() {
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async ({ listing, status }: { listing: NostrEvent; status: GoodsStatus }) => {
      return publish({
        kind: listing.kind,
        content: listing.content,
        tags: withSingleTags(listing.tags.filter(([name]) => name !== 'client'), { status }),
      });
    },
  });
}

/** A tribe moderator hides a listing from the tribe feed (NIP-32 label, as for services). */
export function useHideGoodsListing() {
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async ({ listing, reason }: { listing: NostrEvent; reason?: string }) => {
      const { label, namespace } = MODERATION_LABELS.hide;
      return publish({
        kind: 1985,
        content: reason ?? '',
        tags: [
          ['a', `${listing.kind}:${listing.pubkey}:${tagValue(listing, 'd') ?? ''}`],
          ['l', label, namespace],
          ['L', namespace],
          ['alt', `Goods moderation label: ${label}`],
        ],
      });
    },
  });
}
