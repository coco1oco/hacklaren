import type { Hospital, HospitalService } from './types';

const EARTH_RADIUS_KM = 6371.0088;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Great-circle distance in kilometres (Haversine). Straight-line only; it does not imply travel time. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(km: number | null): string {
  if (km === null || !Number.isFinite(km)) return 'Distance unknown';
  return km < 1 ? 'Approx. <1 km' : `Approx. ${km.toFixed(km < 10 ? 1 : 0)} km`;
}

/** Capability score used as the secondary sort key for emergency selection. */
export function capabilityScore(services: HospitalService[]): number {
  let score = 0;
  if (services.includes('CEmONC')) score += 4;
  if (services.includes('Emergency')) score += 2;
  if (services.includes('NICU')) score += 2;
  if (services.includes('BEmONC')) score += 1;
  return score;
}

export interface RankedHospital<T extends Hospital = Hospital> {
  hospital: T;
  distanceKm: number | null;
}

/**
 * Sort by distance (nearest first), then capability. Hospitals with unknown distance go last.
 * Distances are bucketed to 1 km so a much more capable hospital wins near-ties.
 */
export function rankHospitals<T extends Hospital>(hospitals: T[], origin: LatLng | null): RankedHospital<T>[] {
  return hospitals
    .map((hospital) => ({
      hospital,
      distanceKm: origin ? haversineKm(origin, hospital) : null,
    }))
    .sort((a, b) => {
      if (a.distanceKm !== null && b.distanceKm !== null) {
        const da = Math.round(a.distanceKm);
        const db = Math.round(b.distanceKm);
        if (da !== db) return da - db;
      } else if (a.distanceKm !== null) {
        return -1;
      } else if (b.distanceKm !== null) {
        return 1;
      }
      const cap = capabilityScore(b.hospital.services) - capabilityScore(a.hospital.services);
      if (cap !== 0) return cap;
      return a.hospital.name.localeCompare(b.hospital.name);
    });
}
