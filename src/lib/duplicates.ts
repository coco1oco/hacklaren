import type { PatientDoc } from '@shared/contracts';
import { normalizeName, normalizePhone } from './format';

function tokens(name: string): string[] {
  return normalizeName(name)
    .split(' ')
    .filter((t) => t.length >= 3);
}

function similarName(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = new Set(tokens(b));
  return ta.some((t) => tb.has(t));
}

export interface DuplicateCandidate {
  name: string;
  birthdate: string;
  contactNumber: string;
  lmp: string;
}

/** Possible existing patients in the same clinic (client-side, works offline from cache). */
export function findPossibleDuplicates<T extends PatientDoc>(input: DuplicateCandidate, patients: T[], excludeId?: string): T[] {
  const nameLower = normalizeName(input.name);
  const phone = normalizePhone(input.contactNumber);
  return patients.filter((p) => {
    if (p.patientId === excludeId) return false;
    if (p.nameLower === nameLower) return true;
    if (phone && normalizePhone(p.contactNumber) === phone) return true;
    if (input.birthdate && p.birthdate === input.birthdate && similarName(p.name, input.name)) return true;
    if (input.lmp && p.pregnancy?.lmp === input.lmp && similarName(p.name, input.name)) return true;
    return false;
  });
}
