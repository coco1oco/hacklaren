import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  CLINIC_A,
  CLINIC_B,
  PATIENT_A,
  PATIENT_B,
  REQUEST_ID,
  USERS,
  VISIT_A,
  auditDoc,
  dbAs,
  fixedTs,
  patientDoc,
  referralRequestDoc,
  seed,
  serverTs,
  setupEnv,
  visitDoc,
} from './helpers';

let env: RulesTestEnvironment;
const MW = USERS.midwifeA.uid;
const NEW_PATIENT = 'MARA-PAT-NEW2';

beforeAll(async () => {
  env = await setupEnv();
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
});

const newPatient = (overrides: Record<string, unknown> = {}) => ({
  ...patientDoc({ patientId: NEW_PATIENT, clinicId: CLINIC_A, uid: MW, ts: serverTs() }),
  ...overrides,
});

const patientUpdate = (overrides: Record<string, unknown> = {}) => ({
  name: 'Renamed Patient',
  nameLower: 'renamed patient',
  version: 2,
  updatedAt: serverTs(),
  updatedBy: MW,
  ...overrides,
});

describe('patient create', () => {
  it('valid create succeeds', async () => {
    await assertSucceeds(dbAs(env, 'midwifeA').doc(`patients/${NEW_PATIENT}`).set(newPatient()));
  });

  it('clinic_admin may also register patients for own clinic', async () => {
    const data = patientDoc({ patientId: NEW_PATIENT, clinicId: CLINIC_A, uid: USERS.adminA.uid, ts: serverTs() });
    await assertSucceeds(dbAs(env, 'adminA').doc(`patients/${NEW_PATIENT}`).set(data));
  });

  it('wrong clinicId is rejected', async () => {
    await assertFails(dbAs(env, 'midwifeA').doc(`patients/${NEW_PATIENT}`).set(newPatient({ clinicId: CLINIC_B })));
  });

  it('spoofed createdBy / updatedBy / consent.capturedBy is rejected', async () => {
    const db = dbAs(env, 'midwifeA');
    await assertFails(db.doc(`patients/${NEW_PATIENT}`).set(newPatient({ createdBy: 'someone-else' })));
    await assertFails(db.doc(`patients/${NEW_PATIENT}`).set(newPatient({ updatedBy: 'someone-else' })));
    await assertFails(
      db.doc(`patients/${NEW_PATIENT}`).set(newPatient({ consent: { dataSharingForReferral: true, capturedAt: serverTs(), capturedBy: 'x' } })),
    );
  });

  it('client-supplied timestamps (not serverTimestamp) are rejected', async () => {
    const db = dbAs(env, 'midwifeA');
    await assertFails(db.doc(`patients/${NEW_PATIENT}`).set(newPatient({ createdAt: fixedTs() })));
    await assertFails(db.doc(`patients/${NEW_PATIENT}`).set(newPatient({ updatedAt: fixedTs() })));
    await assertFails(
      db.doc(`patients/${NEW_PATIENT}`).set(newPatient({ consent: { dataSharingForReferral: true, capturedAt: fixedTs(), capturedBy: MW } })),
    );
  });

  it('id mismatch, bad id format, version != 1, extra / missing keys are rejected', async () => {
    const db = dbAs(env, 'midwifeA');
    await assertFails(db.doc('patients/MARA-PAT-OTHER1').set(newPatient()));
    await assertFails(db.doc('patients/bad-id').set(newPatient({ patientId: 'bad-id' })));
    await assertFails(db.doc(`patients/${NEW_PATIENT}`).set(newPatient({ version: 5 })));
    await assertFails(db.doc(`patients/${NEW_PATIENT}`).set(newPatient({ role: 'super_admin' })));
    const missing: Record<string, unknown> = newPatient();
    delete missing.consent;
    await assertFails(db.doc(`patients/${NEW_PATIENT}`).set(missing));
  });

  it('basic type checks are enforced', async () => {
    const db = dbAs(env, 'midwifeA');
    await assertFails(db.doc(`patients/${NEW_PATIENT}`).set(newPatient({ name: '' })));
    await assertFails(db.doc(`patients/${NEW_PATIENT}`).set(newPatient({ nameLower: 'Not Lower' })));
    await assertFails(
      db.doc(`patients/${NEW_PATIENT}`).set(newPatient({ pregnancy: { lmp: '2025-01-01', edd: '2025-10-08', gravida: 'two', para: 1 } })),
    );
    await assertFails(db.doc(`patients/${NEW_PATIENT}`).set(newPatient({ bloodType: 'Z' })));
  });

  it('super_admin cannot create patients', async () => {
    const data = patientDoc({ patientId: NEW_PATIENT, clinicId: CLINIC_A, uid: USERS.superAdmin.uid, ts: serverTs() });
    await assertFails(dbAs(env, 'superAdmin').doc(`patients/${NEW_PATIENT}`).set(data));
  });
});

describe('patient update', () => {
  it('version + 1 with server timestamp succeeds', async () => {
    await assertSucceeds(dbAs(env, 'midwifeA').doc(`patients/${PATIENT_A}`).update(patientUpdate()));
  });

  it('stale version (offline replay) is rejected', async () => {
    const db = dbAs(env, 'midwifeA');
    await assertFails(db.doc(`patients/${PATIENT_A}`).update(patientUpdate({ version: 1 })));
    await assertFails(db.doc(`patients/${PATIENT_A}`).update(patientUpdate({ version: 3 })));
  });

  it('immutable fields cannot change', async () => {
    const db = dbAs(env, 'midwifeA');
    await assertFails(db.doc(`patients/${PATIENT_A}`).update(patientUpdate({ clinicId: CLINIC_B })));
    await assertFails(db.doc(`patients/${PATIENT_A}`).update(patientUpdate({ createdBy: 'x' })));
    await assertFails(db.doc(`patients/${PATIENT_A}`).update(patientUpdate({ createdAt: serverTs() })));
  });

  it('spoofed updatedBy or client updatedAt is rejected', async () => {
    const db = dbAs(env, 'midwifeA');
    await assertFails(db.doc(`patients/${PATIENT_A}`).update(patientUpdate({ updatedBy: 'x' })));
    await assertFails(db.doc(`patients/${PATIENT_A}`).update(patientUpdate({ updatedAt: fixedTs() })));
  });

  it('consent change must be re-captured by the caller at request.time', async () => {
    const db = dbAs(env, 'midwifeA');
    await assertFails(
      db.doc(`patients/${PATIENT_A}`).update(patientUpdate({ consent: { dataSharingForReferral: false, capturedAt: fixedTs(), capturedBy: MW } })),
    );
    await assertSucceeds(
      db.doc(`patients/${PATIENT_A}`).update(patientUpdate({ consent: { dataSharingForReferral: false, capturedAt: serverTs(), capturedBy: MW } })),
    );
  });

  it('patients cannot be deleted', async () => {
    await assertFails(dbAs(env, 'adminA').doc(`patients/${PATIENT_A}`).delete());
  });
});

describe('visits', () => {
  const NEW_VISIT = 'visit-new';
  const newVisit = (overrides: Record<string, unknown> = {}) => ({
    ...visitDoc({ visitId: NEW_VISIT, patientId: PATIENT_A, clinicId: CLINIC_A, uid: MW, ts: serverTs() }),
    ...overrides,
  });
  const visitUpdate = (overrides: Record<string, unknown> = {}) => ({
    notes: 'Updated note',
    version: 2,
    updatedAt: serverTs(),
    updatedBy: MW,
    ...overrides,
  });

  it('valid create succeeds (optional numeric fields may be omitted)', async () => {
    const db = dbAs(env, 'midwifeA');
    await assertSucceeds(db.doc(`patients/${PATIENT_A}/visits/${NEW_VISIT}`).set(newVisit()));
    const minimal: Record<string, unknown> = newVisit({ visitId: 'visit-min' });
    delete minimal.fhr;
    delete minimal.glucoseMgDl;
    delete minimal.fundalHeightCm;
    await assertSucceeds(db.doc(`patients/${PATIENT_A}/visits/visit-min`).set(minimal));
  });

  it('cross-clinic or mismatched ids are rejected', async () => {
    const db = dbAs(env, 'midwifeA');
    await assertFails(db.doc(`patients/${PATIENT_A}/visits/${NEW_VISIT}`).set(newVisit({ clinicId: CLINIC_B })));
    await assertFails(db.doc(`patients/${PATIENT_A}/visits/${NEW_VISIT}`).set(newVisit({ patientId: PATIENT_B })));
    await assertFails(db.doc(`patients/${PATIENT_A}/visits/${NEW_VISIT}`).set(newVisit({ visitId: 'other' })));
    await assertFails(
      db.doc(`patients/${PATIENT_B}/visits/${NEW_VISIT}`).set(newVisit({ patientId: PATIENT_B, clinicId: CLINIC_B })),
    );
    await assertFails(
      db.doc('patients/MARA-PAT-NONE/visits/v1').set(newVisit({ visitId: 'v1', patientId: 'MARA-PAT-NONE' })),
    );
  });

  it('spoofed audit metadata on create is rejected', async () => {
    const db = dbAs(env, 'midwifeA');
    await assertFails(db.doc(`patients/${PATIENT_A}/visits/${NEW_VISIT}`).set(newVisit({ createdBy: 'x' })));
    await assertFails(db.doc(`patients/${PATIENT_A}/visits/${NEW_VISIT}`).set(newVisit({ createdAt: fixedTs() })));
    await assertFails(db.doc(`patients/${PATIENT_A}/visits/${NEW_VISIT}`).set(newVisit({ version: 2 })));
  });

  it('hard limits are enforced', async () => {
    const db = dbAs(env, 'midwifeA');
    const bad: Record<string, unknown>[] = [
      { bpSystolic: 400 },
      { bpDiastolic: 5 },
      { bpSystolic: 80, bpDiastolic: 90 },
      { weightKg: 10 },
      { fhr: 300 },
      { glucoseMgDl: 5 },
      { fundalHeightCm: 99 },
      { bpSystolic: '120' },
      { urineProtein: '9+' },
      { notes: 'x'.repeat(4001) },
      { dangerSigns: { bleeding: 'no', severeHeadache: false, blurredVision: false, reducedFetalMovement: false } },
      { unexpected: true },
    ];
    for (const o of bad) {
      await assertFails(db.doc(`patients/${PATIENT_A}/visits/${NEW_VISIT}`).set(newVisit(o)));
    }
  });

  it('update with version + 1 succeeds; immutable audit metadata cannot change', async () => {
    const db = dbAs(env, 'midwifeA');
    const ref = db.doc(`patients/${PATIENT_A}/visits/${VISIT_A}`);
    await assertFails(ref.update(visitUpdate({ createdBy: 'x' })));
    await assertFails(ref.update(visitUpdate({ createdByName: 'Someone Else' })));
    await assertFails(ref.update(visitUpdate({ createdAt: serverTs() })));
    await assertFails(ref.update(visitUpdate({ clinicId: CLINIC_B })));
    await assertFails(ref.update(visitUpdate({ patientId: PATIENT_B })));
    await assertFails(ref.update(visitUpdate({ version: 1 })));
    await assertFails(ref.update(visitUpdate({ updatedBy: 'x' })));
    await assertFails(ref.update(visitUpdate({ updatedAt: fixedTs() })));
    await assertSucceeds(ref.update(visitUpdate()));
  });

  it('other clinic cannot update; nobody can delete', async () => {
    await assertFails(
      dbAs(env, 'midwifeB').doc(`patients/${PATIENT_A}/visits/${VISIT_A}`).update(visitUpdate({ updatedBy: USERS.midwifeB.uid })),
    );
    await assertFails(dbAs(env, 'adminA').doc(`patients/${PATIENT_A}/visits/${VISIT_A}`).delete());
  });
});

describe('auditLogs (client append)', () => {
  it('allowed action for own uid/clinic succeeds', async () => {
    await assertSucceeds(dbAs(env, 'midwifeA').collection('auditLogs').add(auditDoc()));
    await assertSucceeds(dbAs(env, 'midwifeA').collection('auditLogs').add(auditDoc({ action: 'visit_created' })));
    await assertSucceeds(dbAs(env, 'midwifeA').collection('auditLogs').add(auditDoc({ patientId: null })));
    await assertSucceeds(
      dbAs(env, 'adminA').collection('auditLogs').add(auditDoc({ actorUid: USERS.adminA.uid, actorRole: 'clinic_admin' })),
    );
  });

  it('non-empty details are rejected', async () => {
    const col = dbAs(env, 'midwifeA').collection('auditLogs');
    await assertFails(col.add(auditDoc({ details: { offline: true } })));
    await assertFails(col.add(auditDoc({ details: 'text' })));
  });

  it('patientId must reference an existing patient of the caller clinic', async () => {
    const col = dbAs(env, 'midwifeA').collection('auditLogs');
    await assertFails(col.add(auditDoc({ patientId: PATIENT_B })));
    await assertFails(col.add(auditDoc({ patientId: 'MARA-PAT-NONE' })));
    await assertFails(col.add(auditDoc({ patientId: '' })));
  });

  it('server-only actions are rejected', async () => {
    for (const action of ['referral_sent', 'summary_approved', 'staff_created', 'referral_viewed']) {
      await assertFails(dbAs(env, 'midwifeA').collection('auditLogs').add(auditDoc({ action })));
    }
  });

  it('spoofed actor / clinic / role / timestamp are rejected', async () => {
    const col = dbAs(env, 'midwifeA').collection('auditLogs');
    await assertFails(col.add(auditDoc({ actorUid: USERS.midwifeB.uid })));
    await assertFails(col.add(auditDoc({ clinicId: CLINIC_B })));
    await assertFails(col.add(auditDoc({ actorRole: 'clinic_admin' })));
    await assertFails(col.add(auditDoc({ actorKind: 'system' })));
    await assertFails(col.add(auditDoc({ at: fixedTs() })));
    await assertFails(col.add(auditDoc({ referralId: 'ref-x' })));
    await assertFails(col.add(auditDoc({ note: 'extra key' })));
  });

  it('audit logs are append-only and anonymous users cannot write', async () => {
    await assertFails(dbAs(env, 'adminA').doc(`auditLogs/log-${CLINIC_A}`).update({ details: {} }));
    await assertFails(dbAs(env, 'superAdmin').doc(`auditLogs/log-${CLINIC_A}`).delete());
    await assertFails(dbAs(env, 'anon').collection('auditLogs').add(auditDoc()));
  });
});

describe('referralRequests (offline emergency queue)', () => {
  it('valid queued request succeeds and creator can read it', async () => {
    const db = dbAs(env, 'midwifeA');
    await assertSucceeds(db.doc(`referralRequests/${REQUEST_ID}`).set(referralRequestDoc()));
    await assertSucceeds(db.doc(`referralRequests/${REQUEST_ID}`).get());
    await assertSucceeds(dbAs(env, 'adminA').doc(`referralRequests/${REQUEST_ID}`).get());
    await assertFails(dbAs(env, 'midwifeB').doc(`referralRequests/${REQUEST_ID}`).get());
  });

  it('spoofed or malformed requests are rejected', async () => {
    const db = dbAs(env, 'midwifeA');
    const bad: Record<string, unknown>[] = [
      { clinicId: CLINIC_B },
      { createdBy: USERS.midwifeB.uid },
      { createdAt: fixedTs() },
      { state: 'processed' },
      { referralId: 'MARA-REF-XXXX' },
      { error: 'x' },
      { type: 'checkup' },
      { clientRequestId: '11111111-1111-4111-8111-111111111111' },
      { reasonCode: 'diagnosis' },
      { reasonText: 'x'.repeat(1001) },
      { patientId: PATIENT_B },
      { status: 'SENT' },
    ];
    for (const o of bad) {
      await assertFails(db.doc(`referralRequests/${REQUEST_ID}`).set(referralRequestDoc(o)));
    }
    await assertFails(db.doc('referralRequests/not-a-uuid').set(referralRequestDoc({ clientRequestId: 'not-a-uuid' })));
  });

  it('super_admin cannot queue; nobody can update or delete', async () => {
    await assertFails(
      dbAs(env, 'superAdmin').doc(`referralRequests/${REQUEST_ID}`).set(referralRequestDoc({ clinicId: null, createdBy: USERS.superAdmin.uid })),
    );
    await assertSucceeds(dbAs(env, 'midwifeA').doc(`referralRequests/${REQUEST_ID}`).set(referralRequestDoc()));
    await assertFails(dbAs(env, 'midwifeA').doc(`referralRequests/${REQUEST_ID}`).update({ state: 'processed' }));
    await assertFails(dbAs(env, 'adminA').doc(`referralRequests/${REQUEST_ID}`).delete());
  });
});

describe('deactivated staff (valid claims, inactive midwives profile)', () => {
  const OFF = USERS.inactiveMidwifeA.uid;
  const GHOST = USERS.ghostMidwifeA.uid;

  it('inactive midwife cannot create a patient', async () => {
    const data = patientDoc({ patientId: NEW_PATIENT, clinicId: CLINIC_A, uid: OFF, ts: serverTs() });
    await assertFails(dbAs(env, 'inactiveMidwifeA').doc(`patients/${NEW_PATIENT}`).set(data));
  });

  it('midwife with no staff profile cannot create a patient', async () => {
    const data = patientDoc({ patientId: NEW_PATIENT, clinicId: CLINIC_A, uid: GHOST, ts: serverTs() });
    await assertFails(dbAs(env, 'ghostMidwifeA').doc(`patients/${NEW_PATIENT}`).set(data));
  });

  it('inactive midwife cannot update a patient', async () => {
    await assertFails(
      dbAs(env, 'inactiveMidwifeA').doc(`patients/${PATIENT_A}`).update(patientUpdate({ updatedBy: OFF })),
    );
  });

  it('inactive midwife cannot create or update a visit', async () => {
    const db = dbAs(env, 'inactiveMidwifeA');
    const v = visitDoc({ visitId: 'visit-off', patientId: PATIENT_A, clinicId: CLINIC_A, uid: OFF, ts: serverTs() });
    await assertFails(db.doc(`patients/${PATIENT_A}/visits/visit-off`).set(v));
    await assertFails(
      db.doc(`patients/${PATIENT_A}/visits/${VISIT_A}`).update({ notes: 'x', version: 2, updatedAt: serverTs(), updatedBy: OFF }),
    );
  });

  it('inactive midwife cannot queue referral requests or write audit logs', async () => {
    const db = dbAs(env, 'inactiveMidwifeA');
    await assertFails(db.doc(`referralRequests/${REQUEST_ID}`).set(referralRequestDoc({ createdBy: OFF })));
    await assertFails(db.collection('auditLogs').add(auditDoc({ actorUid: OFF })));
  });

  it('reads remain available until the ID token expires (documented residual window)', async () => {
    await assertSucceeds(dbAs(env, 'inactiveMidwifeA').doc(`patients/${PATIENT_A}`).get());
  });

  it('reactivated profile restores write access', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`midwives/${OFF}`).update({ active: true });
    });
    const data = patientDoc({ patientId: NEW_PATIENT, clinicId: CLINIC_A, uid: OFF, ts: serverTs() });
    await assertSucceeds(dbAs(env, 'inactiveMidwifeA').doc(`patients/${NEW_PATIENT}`).set(data));
  });
});
