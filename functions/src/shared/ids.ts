// Human-readable identifiers. Uses Web Crypto (available in modern browsers and Node 20+).
// Patient IDs are generated on the client so patients can be registered offline.

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I to avoid misreading

function randomCode(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]; // 256 % 32 === 0 → no modulo bias
  return out;
}

export function newPatientId(): string {
  return `MARA-PAT-${randomCode(8)}`;
}

export function newReferralId(): string {
  return `MARA-REF-${randomCode(8)}`;
}

export function newClinicId(): string {
  return `CLINIC-${randomCode(8)}`;
}

/** Clinic server (join) code, e.g. "K7QM-3XRT": 8 chars from a 32-symbol alphabet = 40 bits, rate limited on use. */
export function newJoinCode(): string {
  const c = randomCode(8);
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

// Accept 4–12 alphanumerics so seeded demo IDs (e.g. MARA-PAT-2841) are valid too.
export const PATIENT_ID_PATTERN = /^MARA-PAT-[0-9A-Z]{4,12}$/;
export const REFERRAL_ID_PATTERN = /^MARA-REF-[0-9A-Z]{4,12}$/;
