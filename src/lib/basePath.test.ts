import { afterEach, describe, expect, it, vi } from 'vitest';
import { appUrl, normalizeBasePath, routerBasename } from './basePath';

describe('base path', () => {
  it('normalizes the configured base path', () => {
    expect(normalizeBasePath(undefined)).toBe('/');
    expect(normalizeBasePath('')).toBe('/');
    expect(normalizeBasePath('/')).toBe('/');
    expect(normalizeBasePath('village_vibe')).toBe('/village_vibe/');
    expect(normalizeBasePath('/village_vibe')).toBe('/village_vibe/');
    expect(normalizeBasePath('/village_vibe/')).toBe('/village_vibe/');
    expect(normalizeBasePath('/a/b/')).toBe('/a/b/');
  });

  it('rejects values that are not a path', () => {
    expect(() => normalizeBasePath('https://example.com/')).toThrow(/Invalid base path/);
    expect(() => normalizeBasePath('/../etc/')).toThrow(/Invalid base path/);
    expect(() => normalizeBasePath('/with space/')).toThrow(/Invalid base path/);
  });

  it('derives the router basename and absolute route URLs', () => {
    expect(routerBasename('/')).toBe('/');
    expect(routerBasename('/village_vibe/')).toBe('/village_vibe');
    expect(appUrl('tribe/abc:d', '/', 'https://vv.example')).toBe('https://vv.example/tribe/abc:d');
    expect(appUrl('/tribe/abc:d', '/village_vibe/', 'https://erp-ftw.github.io')).toBe('https://erp-ftw.github.io/village_vibe/tribe/abc:d');
  });
});

describe('share and QR links under a subpath', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('include the base path the build is served under', async () => {
    vi.stubEnv('BASE_URL', '/village_vibe/');
    const { createTribeShareLinks } = await import('./nostrLinks');
    const { tribeServicesUrl } = await import('./qrGenerator');
    const origin = window.location.origin;

    const links = createTribeShareLinks('a'.repeat(64), 'garden club', 'Garden Club');
    expect(links.web).toBe(`${origin}/village_vibe/tribe/${'a'.repeat(64)}:garden%20club`);
    expect(links.text).toContain(links.web);
    expect(tribeServicesUrl('pk:d')).toBe(`${origin}/village_vibe/tribe/pk:d?tab=services`);
  });

  it('stay at the root for a root deployment', async () => {
    vi.stubEnv('BASE_URL', '/');
    const { tribeServicesUrl } = await import('./qrGenerator');
    expect(tribeServicesUrl('pk:d')).toBe(`${window.location.origin}/tribe/pk:d?tab=services`);
  });
});
