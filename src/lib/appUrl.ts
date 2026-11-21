import { appUrl as buildAppUrl, routerBasename } from './basePath';

/** Absolute URL of an in-app route as served now (origin + base path + route). */
export function appUrl(path: string): string {
  return buildAppUrl(path, import.meta.env.BASE_URL, window.location.origin);
}

/** Router basename matching the base path the build was made for. */
export const ROUTER_BASENAME = routerBasename(import.meta.env.BASE_URL);
