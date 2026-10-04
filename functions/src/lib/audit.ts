import { FieldValue, type Transaction, type WriteBatch } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/logger';
import { COLLECTIONS, type AuditLogDoc } from '../shared/contracts';
import { db } from './firebase';

/** Audit entry without timestamp. `details` must be small and non-clinical. */
export type AuditEntry = Omit<AuditLogDoc, 'at'>;

export function auditData(entry: AuditEntry): Omit<AuditLogDoc, 'at'> & { at: FieldValue } {
  return { ...entry, details: entry.details ?? {}, at: FieldValue.serverTimestamp() };
}

/** Adds an audit write to an existing transaction (preferred: audit commits atomically with the change). */
export function auditInTx(tx: Transaction, entry: AuditEntry): void {
  tx.set(db().collection(COLLECTIONS.auditLogs).doc(), auditData(entry));
}

export function auditInBatch(batch: WriteBatch, entry: AuditEntry): void {
  batch.set(db().collection(COLLECTIONS.auditLogs).doc(), auditData(entry));
}

/** Standalone audit write. Never throws: a failed audit write is logged but must not break the workflow. */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await db().collection(COLLECTIONS.auditLogs).add(auditData(entry));
  } catch (err) {
    logger.error('Audit write failed', { action: entry.action, message: err instanceof Error ? err.message : String(err) });
  }
}
