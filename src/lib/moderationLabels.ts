export type ModerationAction = 'hide' | 'promote' | 'feature';

/** NIP-32 label value and namespace for each moderation action. */
export const MODERATION_LABELS: Record<ModerationAction, { label: string; namespace: string }> = {
  hide: { label: 'tribe-hidden', namespace: 'moderation' },
  promote: { label: 'village-promoted', namespace: 'promotion' },
  feature: { label: 'village-featured', namespace: 'promotion' },
};
