/** In-app route for an addressable event, or null when the app has no page for its kind. */
export function addressRoute(kind: number, pubkey: string, identifier: string): string | null {
  const id = `${pubkey}:${encodeURIComponent(identifier)}`;
  switch (kind) {
    case 36959:
    case 31923:
      return `/event/${id}`;
    case 34550:
      return `/tribe/${id}`;
    case 30023:
      return `/story/${id}`;
    default:
      return null;
  }
}
