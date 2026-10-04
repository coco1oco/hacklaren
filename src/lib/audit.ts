import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { COLLECTIONS } from '@shared/contracts';
import { db } from './firebase';
import type { WriteCtx } from './writes';

export type ClientAuditAction = 'patient_viewed' | 'patient_created' | 'patient_edited' | 'visit_created' | 'visit_edited';

/** Client-side audit entry. Never contains clinical content. Not awaited (works offline). */
export function logAudit(ctx: WriteCtx, action: ClientAuditAction, patientId: string): void {
  addDoc(collection(db, COLLECTIONS.auditLogs), {
    action,
    actorKind: 'user',
    actorUid: ctx.uid,
    actorRole: ctx.role,
    clinicId: ctx.clinicId,
    patientId,
    referralId: null,
    at: serverTimestamp(),
    details: {},
  }).catch(() => console.warn('Audit log write failed', action));
}
