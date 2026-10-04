import { describe, expect, it } from 'vitest';
import { formatDistance, haversineKm, rankHospitals } from './geo';
import type { Hospital } from './types';

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm({ latitude: 14.6, longitude: 121 }, { latitude: 14.6, longitude: 121 })).toBe(0);
  });
  it('matches a known distance (Manila → Cebu ≈ 571 km)', () => {
    const d = haversineKm({ latitude: 14.5995, longitude: 120.9842 }, { latitude: 10.3157, longitude: 123.8854 });
    expect(d).toBeGreaterThan(560);
    expect(d).toBeLessThan(580);
  });
  it('formats as approximate', () => {
    expect(formatDistance(3.456)).toBe('Approx. 3.5 km');
    expect(formatDistance(0.4)).toBe('Approx. <1 km');
    expect(formatDistance(null)).toBe('Distance unknown');
  });
});

describe('rankHospitals', () => {
  const base: Omit<Hospital, 'id' | 'name' | 'latitude' | 'longitude' | 'services'> = {
    address: '',
    phone: '',
    referralLevel: 2,
    dohNetworked: true,
    active: true,
  };
  const near: Hospital = { ...base, id: 'a', name: 'Near', latitude: 14.6, longitude: 121.0, services: ['Emergency'] };
  const nearCapable: Hospital = { ...base, id: 'b', name: 'Near Capable', latitude: 14.6001, longitude: 121.0001, services: ['CEmONC', 'NICU', 'Emergency'] };
  const far: Hospital = { ...base, id: 'c', name: 'Far', latitude: 15.6, longitude: 121.0, services: ['CEmONC', 'NICU'] };

  it('sorts by distance then capability', () => {
    const ranked = rankHospitals([far, near, nearCapable], { latitude: 14.6, longitude: 121.0 });
    expect(ranked.map((r) => r.hospital.id)).toEqual(['b', 'a', 'c']);
  });
  it('falls back to capability without origin', () => {
    const ranked = rankHospitals([near, far, nearCapable], null);
    expect(ranked[0].hospital.id).toBe('b');
    expect(ranked.every((r) => r.distanceKm === null)).toBe(true);
  });
});
