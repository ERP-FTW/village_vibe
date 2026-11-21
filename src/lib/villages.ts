/** Canonical form of a village name as stored in `village` tags and used in URLs. */
export function slugifyVillage(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Human-readable name for a village slug ("east-side" -> "East Side"). */
export function villageDisplayName(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map(word => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Villages to query: a slug, the special "main" page (all villages), or a list.
 * An empty list means all villages.
 */
export function villageList(villages: string | string[]): string[] {
  const list = Array.isArray(villages) ? villages : villages === 'main' ? [] : [villages];
  return [...new Set(list.map(slugifyVillage).filter(Boolean))];
}
