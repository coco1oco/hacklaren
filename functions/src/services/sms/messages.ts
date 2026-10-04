// Pure SMS message builders. Messages contain ONLY a referral ID, hospital/clinic name and (link SMS) the URL.
// NEVER include BP, FHR, diagnoses, notes, history, or any other clinical content.

/** Removes line breaks/control chars and limits length of names inserted into SMS bodies. */
export function cleanName(s: string, max = 60): string {
  // Drop control characters (code points < 0x20) so names cannot inject line breaks.
  const one = Array.from(s ?? '', (ch) => (ch.charCodeAt(0) < 0x20 ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}.` : one;
}

export function patientReferralCreated(referralId: string, hospitalName: string): string {
  return `MARA: Referral ${referralId} has been created for ${cleanName(hospitalName)}.`;
}

export function emergencyAlert(referralId: string, clinicName: string, hospitalName: string): string {
  return `MARA EMERGENCY: Referral ${referralId} from ${cleanName(clinicName)} to ${cleanName(hospitalName)}. Please coordinate with the clinic.`;
}

export function hospitalReferralLink(referralId: string, clinicName: string, url: string, emergency: boolean): string {
  return `MARA: ${emergency ? 'EMERGENCY referral' : 'Referral'} ${referralId} from ${cleanName(clinicName)}. Open record: ${url}`;
}

export function midwifeReferralLink(referralId: string, hospitalName: string, url: string): string {
  return `MARA: Hospital link for referral ${referralId} to ${cleanName(hospitalName)}: ${url}`;
}

export function midwifeStatusAcknowledged(referralId: string, hospitalName: string): string {
  return `MARA: Referral ${referralId} was acknowledged by ${cleanName(hospitalName)}.`;
}

/** The decline reason is intentionally NOT included (it may contain clinical content). */
export function midwifeStatusDeclined(referralId: string, hospitalName: string): string {
  return `MARA: Referral ${referralId} was declined by ${cleanName(hospitalName)}. Open MARA for details.`;
}

/** Replaces raw link tokens so SMS bodies can be stored in smsLogs without storing the token. */
export function redactLinks(message: string): string {
  return message.replace(/\/referral\/[A-Za-z0-9_-]{20,}/g, '/referral/[redacted]');
}

export function containsLink(message: string): boolean {
  return /\/referral\/(\[redacted\]|[A-Za-z0-9_-]{20,})/.test(message);
}

/** Normalises PH mobile numbers to 09XXXXXXXXX. Returns null for landlines or invalid input. */
export function normalizePhMobile(n: string): string | null {
  if (typeof n !== 'string') return null;
  const s = n.replace(/[\s().-]/g, '');
  let m = /^\+?639(\d{9})$/.exec(s);
  if (m) return `09${m[1]}`;
  m = /^09(\d{9})$/.exec(s);
  if (m) return `09${m[1]}`;
  return null;
}

/** e.g. 09171234567 → 0917•••4567. */
export function maskPhone(n: string): string {
  const normalized = normalizePhMobile(n);
  const digits = normalized ?? (n ?? '').replace(/\D/g, '');
  if (digits.length >= 8) return `${digits.slice(0, 4)}•••${digits.slice(-4)}`;
  if (digits.length >= 2) return `•••${digits.slice(-2)}`;
  return '•••';
}
