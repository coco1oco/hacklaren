import type { ReferralStatus, ReferralType, StatusActor } from './types';

export const TERMINAL_STATUSES: ReferralStatus[] = ['ARRIVED', 'DECLINED', 'EXPIRED', 'CANCELLED'];
export const ACTIVE_STATUSES: ReferralStatus[] = ['CREATED', 'SENT', 'ACKNOWLEDGED'];

/** Base state graph. Type/actor-specific restrictions are applied in canTransition(). */
const GRAPH: Record<ReferralStatus, ReferralStatus[]> = {
  CREATED: ['SENT', 'CANCELLED'],
  SENT: ['ACKNOWLEDGED', 'DECLINED', 'ARRIVED', 'CANCELLED', 'EXPIRED'],
  ACKNOWLEDGED: ['ARRIVED', 'CANCELLED'],
  ARRIVED: [],
  DECLINED: [],
  EXPIRED: [],
  CANCELLED: [],
};

/** Which actor may move a referral into each status. */
const ACTOR_FOR_TARGET: Record<ReferralStatus, StatusActor[]> = {
  CREATED: [],
  SENT: ['midwife', 'system'],
  ACKNOWLEDGED: ['hospital'],
  DECLINED: ['hospital'],
  ARRIVED: ['hospital'],
  CANCELLED: ['midwife'],
  EXPIRED: ['system'],
};

export interface TransitionCheck {
  allowed: boolean;
  reason?: string;
}

export function canTransition(type: ReferralType, from: ReferralStatus, to: ReferralStatus, actor: StatusActor): TransitionCheck {
  if (!GRAPH[from]?.includes(to)) return { allowed: false, reason: `Cannot change status from ${from} to ${to}.` };
  if (!ACTOR_FOR_TARGET[to].includes(actor)) return { allowed: false, reason: `${actor} cannot set status ${to}.` };
  // Emergency referrals do not use a decline workflow; the hospital is expected to call the clinic.
  if (to === 'DECLINED' && type !== 'checkup') return { allowed: false, reason: 'Decline is only available for checkup referrals.' };
  // A checkup patient must be acknowledged before arrival is recorded; emergencies may arrive first.
  if (from === 'SENT' && to === 'ARRIVED' && type !== 'emergency') {
    return { allowed: false, reason: 'Acknowledge the referral before recording arrival.' };
  }
  return { allowed: true };
}

export type HospitalAction = 'ACKNOWLEDGED' | 'DECLINED' | 'ARRIVED';

export function allowedHospitalActions(type: ReferralType, status: ReferralStatus): HospitalAction[] {
  return (['ACKNOWLEDGED', 'DECLINED', 'ARRIVED'] as HospitalAction[]).filter((a) => canTransition(type, status, a, 'hospital').allowed);
}

export function isTerminal(status: ReferralStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export const STATUS_LABELS: Record<ReferralStatus, string> = {
  CREATED: 'Created',
  SENT: 'Sent',
  ACKNOWLEDGED: 'Acknowledged',
  ARRIVED: 'Patient arrived',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

/** Grouping used by the referral dashboard filters. */
export type ReferralFilter = 'active' | 'completed' | 'declined' | 'cancelled' | 'expired';

export function filterForStatus(status: ReferralStatus): ReferralFilter {
  if (ACTIVE_STATUSES.includes(status)) return 'active';
  if (status === 'ARRIVED') return 'completed';
  if (status === 'DECLINED') return 'declined';
  if (status === 'CANCELLED') return 'cancelled';
  return 'expired';
}
