/**
 * The path the app is served under, e.g. "/" at a domain root or "/village_vibe/" for a
 * GitHub Pages project site. Set at build time with VITE_BASE_PATH; Vite exposes the result
 * as import.meta.env.BASE_URL. Builders such as Shakespeare omit BASE_URL, so an
 * absent or empty value defaults to the domain root. Always starts and ends with "/".
 */
export function normalizeBasePath(input: string | undefined): string {
  const trimmed = (input ?? '').trim();
  if (!trimmed || trimmed === '/') return '/';
  if (!/^\/?[A-Za-z0-9._~\-/]+\/?$/.test(trimmed) || trimmed.includes('..')) {
    throw new Error(`Invalid base path "${input}": use something like "/" or "/village_vibe/".`);
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
}

/** React Router basename for a base path ("/" stays "/", "/x/" becomes "/x"). */
export function routerBasename(basePath: string | undefined): string {
  const normalized = normalizeBasePath(basePath);
  return normalized === '/' ? '/' : normalized.replace(/\/$/, '');
}

/** Absolute URL of an in-app route, including the base path. */
export function appUrl(path: string, basePath: string | undefined, origin: string): string {
  return `${origin}${normalizeBasePath(basePath)}${path.replace(/^\/+/, '')}`;
}
