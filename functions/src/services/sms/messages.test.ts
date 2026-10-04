import { describe, expect, it } from 'vitest';
import * as messages from './messages';

const { maskPhone, normalizePhMobile } = messages;

const CLINICAL = [/\bBP\b/, /mmHg/i, /\bFHR\b/, /diagnos/i, /\bbpm\b/i, /glucose/i, /bleeding/i, /eclampsia/i, /protein/i];

const SAMPLE = {
  referralId: 'MARA-REF-AB12',
  hospitalName: 'Provincial Hospital',
  hospital: 'Provincial Hospital',
  clinicName: 'RHU Maligaya',
  clinic: 'RHU Maligaya',
  midwifeName: 'Josefina Reyes',
  midwifeContact: '09990001111',
  midwifeContactNumber: '09990001111',
  url: 'https://mara.vercel.app/referral/' + 'a'.repeat(43),
  link: 'https://mara.vercel.app/referral/' + 'a'.repeat(43),
  linkUrl: 'https://mara.vercel.app/referral/' + 'a'.repeat(43),
  barangay: 'Barangay Maligaya',
  declineReason: 'No OB bed available',
  reason: 'No OB bed available',
  expiresAtMillis: Date.UTC(2026, 9, 6),
  status: 'ACKNOWLEDGED',
};

const POSITIONAL = [SAMPLE.referralId, SAMPLE.hospitalName, SAMPLE.url, SAMPLE.clinicName, SAMPLE.midwifeName];

type AnyFn = (...args: unknown[]) => unknown;

/** Message builders have unknown exact signatures: try an options object first, then positional args. */
function invoke(fn: AnyFn): string | null {
  const attempts: unknown[][] = [[SAMPLE], POSITIONAL];
  let fallback: string | null = null;
  for (const args of attempts) {
    try {
      const out = fn(...args);
      if (typeof out !== 'string') continue;
      if (!out.includes('undefined') && !out.includes('[object Object]')) return out;
      fallback ??= out;
    } catch {
      // try the next calling convention
    }
  }
  return fallback;
}

const builders = Object.entries(messages).filter(
  ([name, v]) => typeof v === 'function' && !['maskPhone', 'normalizePhMobile', 'cleanName', 'redactLinks', 'containsLink'].includes(name),
) as [string, AnyFn][];

describe('normalizePhMobile', () => {
  it('normalises +63 numbers to 09 format', () => {
    expect(normalizePhMobile('+639171234567')).toBe('09171234567');
    expect(normalizePhMobile('09171234567')).toBe('09171234567');
    expect(normalizePhMobile(' 09171234567 ')).toBe('09171234567');
  });
  it('returns null for invalid numbers', () => {
    for (const bad of ['', '12345', '0917123456', '+6391712345678', 'abcdefghijk', '(044) 123-4567']) {
      expect(normalizePhMobile(bad), bad).toBeNull();
    }
  });
});

describe('maskPhone', () => {
  it('hides most digits but keeps the tail', () => {
    const masked = maskPhone('09171234567');
    expect(masked).not.toBe('09171234567');
    expect(masked).not.toContain('9171234');
    expect(masked.endsWith('67')).toBe(true);
  });
});

describe('SMS message builders', () => {
  it('exports at least one builder', () => {
    expect(builders.length).toBeGreaterThan(0);
  });

  it('exports a patient builder with the agreed text', () => {
    const patient = builders.find(([name]) => /patient/i.test(name));
    expect(patient, `no export containing "patient" among: ${builders.map(([n]) => n).join(', ')}`).toBeDefined();
    const text = invoke(patient![1]);
    expect(text).toBe('MARA: Referral MARA-REF-AB12 has been created for Provincial Hospital.');
  });

  it.each(builders.map(([name, fn]) => [name, fn] as const))('%s contains no clinical data', (_name, fn) => {
    const text = invoke(fn);
    if (text === null) return; // not a string builder (e.g. helper)
    for (const re of CLINICAL) expect(text, `matched ${re}`).not.toMatch(re);
    expect(text.length).toBeGreaterThan(0);
  });

  it('patient message never contains the hospital link', () => {
    const patient = builders.find(([name]) => /patient/i.test(name));
    if (!patient) return;
    expect(invoke(patient[1]) ?? '').not.toContain('/referral/');
  });
});

describe('link redaction (smsLogs must never store raw tokens)', () => {
  const token = 'Ab3_-'.repeat(8) + 'xyz'; // 43 chars
  const url = `https://mara.vercel.app/referral/${token}`;
  it('redactLinks removes the raw token', () => {
    const redacted = messages.redactLinks(`Open record: ${url}`);
    expect(redacted).not.toContain(token);
    expect(redacted).toContain('/referral/[redacted]');
  });
  it('containsLink detects raw and redacted links', () => {
    expect(messages.containsLink(url)).toBe(true);
    expect(messages.containsLink(messages.redactLinks(url))).toBe(true);
    expect(messages.containsLink(messages.patientReferralCreated('MARA-REF-AB12', 'Provincial Hospital'))).toBe(false);
  });
});

describe('cleanName', () => {
  it('strips line breaks so names cannot inject extra SMS lines', () => {
    expect(messages.cleanName('Provincial\r\nHospital\tOB')).toBe('Provincial Hospital OB');
  });
  it('truncates long names', () => {
    expect(messages.cleanName('x'.repeat(100)).length).toBeLessThanOrEqual(60);
  });
});
