import { useCallback, useState } from 'react';

export interface ApproximateLocation { lat: number; lon: number }

/**
 * The reader's location, requested only when they ask for something that needs it
 * (e.g. a distance filter). Nothing is requested on page load.
 */
export function useApproximateLocation() {
  const [location, setLocation] = useState<ApproximateLocation | undefined>();
  const [error, setError] = useState<string | undefined>();

  const request = useCallback(() => new Promise<ApproximateLocation | undefined>((resolve) => {
    if (!('geolocation' in navigator)) {
      setError('Location is not available in this browser.');
      resolve(undefined);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const next = { lat: coords.latitude, lon: coords.longitude };
        setLocation(next);
        setError(undefined);
        resolve(next);
      },
      () => {
        setError('Location permission was not granted.');
        resolve(undefined);
      },
      { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 10000 },
    );
  }), []);

  return { location, error, request };
}
