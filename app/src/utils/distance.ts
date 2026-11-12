export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle Haversine distance between two coordinates in kilometers.
 */
export function haversineDistanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

/**
 * Formats a kilometer distance cleanly for quest pills (m, km, or rounded km).
 */
export function formatDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '—';
  if (km < 1) {
    const meters = Math.max(10, Math.round((km * 1000) / 10) * 10);
    return `${meters} m`;
  }
  if (km < 100) {
    return `${km.toFixed(1)} km`;
  }
  return `${Math.round(km).toLocaleString('en-US')} km`;
}
