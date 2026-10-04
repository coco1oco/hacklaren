import { describe, expect, it } from 'vitest';
import { AI_LABELS, CALLABLES, COLLECTIONS, FUNCTIONS_REGION } from './contracts';
import { AUDIT_ACTIONS, CLIENT_AUDIT_ACTIONS } from './types';

describe('CALLABLES', () => {
  it('exposes every callable the backend must deploy', () => {
    const required = [
      'createReferral',
      'generateSummary',
      'sendReferral',
      'getReferralView',
      'updateReferralStatus',
      'cancelReferral',
      'revokeReferralLink',
      'resendReferralLink',
      'resendSms',
      'generateReferralPdf',
      'createStaffUser',
      'setStaffActive',
      'getReferralReport',
      'registerClinic',
      'processReferralRequest',
    ];
    expect(Object.keys(CALLABLES).sort()).toEqual([...required].sort());
  });

  it('uses the key as the deployed function name', () => {
    for (const [key, value] of Object.entries(CALLABLES)) expect(value).toBe(key);
  });

  it('deploys to asia-southeast1', () => {
    expect(FUNCTIONS_REGION).toBe('asia-southeast1');
  });
});

describe('COLLECTIONS', () => {
  it('maps keys to identical collection names', () => {
    for (const [key, value] of Object.entries(COLLECTIONS)) expect(value).toBe(key);
  });
  it('includes the server-only token store', () => {
    expect(COLLECTIONS.referralTokens).toBe('referralTokens');
    expect(COLLECTIONS.rateLimits).toBe('rateLimits');
  });
});

describe('audit actions', () => {
  it('client audit actions are a subset of all audit actions', () => {
    for (const a of CLIENT_AUDIT_ACTIONS) expect(AUDIT_ACTIONS).toContain(a);
  });
  it('clients cannot write referral, sms, summary, pdf or staff audit events', () => {
    for (const a of CLIENT_AUDIT_ACTIONS) expect(a).not.toMatch(/^(referral|sms|summary|pdf|staff)_/);
  });
  it('has no duplicates', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });
});

describe('AI_LABELS', () => {
  it('uses the agreed label wording', () => {
    expect(AI_LABELS.reviewed).toBe('MIDWIFE-REVIEWED');
    expect(AI_LABELS.notReviewed).toBe('NOT YET REVIEWED BY MIDWIFE');
  });
  it('does not claim AI generation (summaries are rule-based)', () => {
    expect(Object.values(AI_LABELS).join(' ')).not.toMatch(/\bAI\b/);
  });
  it('disclaimer states it is not a diagnosis', () => {
    expect(AI_LABELS.disclaimer).toMatch(/Not a diagnosis/);
  });
  it('makes no compliance claims', () => {
    const all = Object.values(AI_LABELS).join(' ');
    expect(all).not.toMatch(/HIPAA|DOH certified|NPC certified/i);
  });
});
