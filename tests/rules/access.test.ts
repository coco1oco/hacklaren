import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { CLINIC_A, CLINIC_B, PATIENT_A, PATIENT_B, VISIT_A, VISIT_B, USERS, clinicDoc, dbAs, hospitalDoc, seed, serverTs, setupEnv } from './helpers';

let env: RulesTestEnvironment;

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

describe('unauthenticated access', () => {
  const privateDocs = [
    `patients/${PATIENT_A}`,
    `patients/${PATIENT_A}/visits/${VISIT_A}`,
    `referrals/ref-${CLINIC_A}`,
    `midwives/${USERS.midwifeA.uid}`,
    `auditLogs/log-${CLINIC_A}`,
    `smsLogs/sms-${CLINIC_A}`,
    `referralTokens/hash-${CLINIC_A}`,
    `clinics/${CLINIC_A}`,
    'hospitals/hosp-1',
    'rateLimits/ip-1',
  ];
  for (const path of privateDocs) {
    it(`cannot read ${path}`, async () => {
      await assertFails(dbAs(env, 'anon').doc(path).get());
    });
  }

  it('cannot list patients or hospitals', async () => {
    await assertFails(dbAs(env, 'anon').collection('patients').get());
    await assertFails(dbAs(env, 'anon').collection('hospitals').get());
  });

  it('signed-in user without role claims cannot read hospitals or clinics', async () => {
    await assertFails(dbAs(env, 'noClaims').doc('hospitals/hosp-1').get());
    await assertFails(dbAs(env, 'noClaims').doc(`clinics/${CLINIC_A}`).get());
  });
});

describe('clinic isolation — patients and visits', () => {
  it('midwife reads own clinic patient and visit', async () => {
    const db = dbAs(env, 'midwifeA');
    await assertSucceeds(db.doc(`patients/${PATIENT_A}`).get());
    await assertSucceeds(db.doc(`patients/${PATIENT_A}/visits/${VISIT_A}`).get());
    await assertSucceeds(db.collection('patients').where('clinicId', '==', CLINIC_A).get());
  });

  it('midwife cannot read another clinic patient or visit', async () => {
    const db = dbAs(env, 'midwifeA');
    await assertFails(db.doc(`patients/${PATIENT_B}`).get());
    await assertFails(db.doc(`patients/${PATIENT_B}/visits/${VISIT_B}`).get());
    await assertFails(db.collection('patients').where('clinicId', '==', CLINIC_B).get());
  });

  it('unfiltered patient list is rejected (query must be scoped to own clinic)', async () => {
    await assertFails(dbAs(env, 'midwifeA').collection('patients').get());
  });

  it('midwife cannot update another clinic patient or add visits there', async () => {
    const db = dbAs(env, 'midwifeA');
    await assertFails(db.doc(`patients/${PATIENT_B}`).update({ name: 'X', nameLower: 'x', version: 2, updatedAt: serverTs(), updatedBy: USERS.midwifeA.uid }));
    await assertFails(
      db.doc(`patients/${PATIENT_B}/visits/new-visit`).set({ visitId: 'new-visit', patientId: PATIENT_B, clinicId: CLINIC_B }),
    );
  });

  it('clinic_admin cannot read another clinic patient', async () => {
    await assertSucceeds(dbAs(env, 'adminA').doc(`patients/${PATIENT_A}`).get());
    await assertFails(dbAs(env, 'adminA').doc(`patients/${PATIENT_B}`).get());
    await assertFails(dbAs(env, 'adminA').doc(`patients/${PATIENT_B}/visits/${VISIT_B}`).get());
  });

  it('super_admin cannot read patients or visits', async () => {
    const db = dbAs(env, 'superAdmin');
    await assertFails(db.doc(`patients/${PATIENT_A}`).get());
    await assertFails(db.doc(`patients/${PATIENT_A}/visits/${VISIT_A}`).get());
    await assertFails(db.collectionGroup('visits').where('clinicId', '==', CLINIC_A).get());
  });

  it('collection-group visits query allowed only for own clinic', async () => {
    const db = dbAs(env, 'midwifeA');
    await assertSucceeds(db.collectionGroup('visits').where('clinicId', '==', CLINIC_A).get());
    await assertFails(db.collectionGroup('visits').where('clinicId', '==', CLINIC_B).get());
    await assertFails(db.collectionGroup('visits').get());
  });
});

describe('other collections — read scoping', () => {
  it('referrals: own clinic staff only (super_admin denied; uses getReferralReport)', async () => {
    await assertSucceeds(dbAs(env, 'midwifeA').doc(`referrals/ref-${CLINIC_A}`).get());
    await assertSucceeds(dbAs(env, 'adminA').doc(`referrals/ref-${CLINIC_A}`).get());
    await assertSucceeds(dbAs(env, 'midwifeA').collection('referrals').where('clinicId', '==', CLINIC_A).get());
    await assertFails(dbAs(env, 'midwifeA').doc(`referrals/ref-${CLINIC_B}`).get());
    await assertFails(dbAs(env, 'superAdmin').doc(`referrals/ref-${CLINIC_A}`).get());
    await assertFails(dbAs(env, 'superAdmin').doc(`referrals/ref-${CLINIC_B}`).get());
    await assertFails(dbAs(env, 'superAdmin').collection('referrals').get());
    await assertFails(dbAs(env, 'superAdmin').collection('referrals').where('clinicId', '==', CLINIC_A).get());
  });

  it('smsLogs: own clinic staff only (super_admin denied)', async () => {
    await assertSucceeds(dbAs(env, 'midwifeA').doc(`smsLogs/sms-${CLINIC_A}`).get());
    await assertSucceeds(dbAs(env, 'adminA').doc(`smsLogs/sms-${CLINIC_A}`).get());
    await assertFails(dbAs(env, 'midwifeA').doc(`smsLogs/sms-${CLINIC_B}`).get());
    await assertFails(dbAs(env, 'superAdmin').doc(`smsLogs/sms-${CLINIC_A}`).get());
    await assertFails(dbAs(env, 'superAdmin').collection('smsLogs').get());
  });

  it('auditLogs: clinic_admin of the clinic and super_admin only', async () => {
    await assertFails(dbAs(env, 'midwifeA').doc(`auditLogs/log-${CLINIC_A}`).get());
    await assertSucceeds(dbAs(env, 'adminA').doc(`auditLogs/log-${CLINIC_A}`).get());
    await assertFails(dbAs(env, 'adminA').doc(`auditLogs/log-${CLINIC_B}`).get());
    await assertSucceeds(dbAs(env, 'superAdmin').doc(`auditLogs/log-${CLINIC_B}`).get());
  });

  it('midwives: own doc, same-clinic staff, super_admin', async () => {
    await assertSucceeds(dbAs(env, 'midwifeA').doc(`midwives/${USERS.midwifeA.uid}`).get());
    await assertSucceeds(dbAs(env, 'adminA').doc(`midwives/${USERS.midwifeA.uid}`).get());
    await assertFails(dbAs(env, 'midwifeB').doc(`midwives/${USERS.midwifeA.uid}`).get());
    await assertSucceeds(dbAs(env, 'superAdmin').doc(`midwives/${USERS.midwifeA.uid}`).get());
  });

  it('referralTokens and rateLimits are never readable, even by super_admin', async () => {
    for (const who of ['midwifeA', 'adminA', 'superAdmin'] as const) {
      await assertFails(dbAs(env, who).doc(`referralTokens/hash-${CLINIC_A}`).get());
      await assertFails(dbAs(env, who).doc('rateLimits/ip-1').get());
    }
  });

  it('clinic server codes are never readable or listable by any client', async () => {
    for (const who of ['anon', 'noClaims', 'midwifeA', 'adminA', 'superAdmin'] as const) {
      await assertFails(dbAs(env, who).doc('clinicJoinCodes/ROSA-2841').get());
      await assertFails(dbAs(env, who).collection('clinicJoinCodes').where('clinicId', '==', CLINIC_A).get());
    }
  });

  it('clinics: own clinic staff and super_admin only', async () => {
    await assertSucceeds(dbAs(env, 'midwifeA').doc(`clinics/${CLINIC_A}`).get());
    await assertFails(dbAs(env, 'midwifeA').doc(`clinics/${CLINIC_B}`).get());
    await assertSucceeds(dbAs(env, 'superAdmin').doc(`clinics/${CLINIC_B}`).get());
  });

  it('hospitals: any staff role may read', async () => {
    await assertSucceeds(dbAs(env, 'midwifeA').doc('hospitals/hosp-1').get());
    await assertSucceeds(dbAs(env, 'superAdmin').collection('hospitals').get());
  });

  it('unknown collections are denied', async () => {
    await assertFails(dbAs(env, 'superAdmin').doc('somethingElse/x').get());
    await assertFails(dbAs(env, 'superAdmin').doc('somethingElse/x').set({ a: 1 }));
  });
});

describe('server-only collections reject client writes', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['referrals/ref-new', { clinicId: CLINIC_A, status: 'SENT' }],
    [`referrals/ref-${CLINIC_A}`, { clinicId: CLINIC_A, status: 'ARRIVED' }],
    ['referralTokens/abc', { referralId: 'ref-x', clinicId: CLINIC_A, revoked: false }],
    ['smsLogs/sms-new', { clinicId: CLINIC_A, status: 'sent' }],
    [`midwives/${USERS.midwifeA.uid}`, { uid: USERS.midwifeA.uid, clinicId: CLINIC_A, role: 'clinic_admin' }],
    ['rateLimits/ip-1', { count: 0 }],
    ['clinicJoinCodes/ROSA-2841', { clinicId: CLINIC_A, active: true }],
  ];
  for (const [path, data] of cases) {
    for (const who of ['midwifeA', 'adminA', 'superAdmin'] as const) {
      it(`${who} cannot write ${path}`, async () => {
        await assertFails(dbAs(env, who).doc(path).set(data));
      });
    }
  }

  it('clients cannot delete referrals or smsLogs', async () => {
    await assertFails(dbAs(env, 'adminA').doc(`referrals/ref-${CLINIC_A}`).delete());
    await assertFails(dbAs(env, 'adminA').doc(`smsLogs/sms-${CLINIC_A}`).delete());
  });
});

describe('super_admin system configuration', () => {
  it('can create and update hospitals with valid data', async () => {
    const db = dbAs(env, 'superAdmin');
    await assertSucceeds(db.doc('hospitals/hosp-2').set(hospitalDoc(serverTs())));
    await assertSucceeds(db.doc('hospitals/hosp-1').update({ active: false, updatedAt: serverTs() }));
  });

  it('rejects invalid hospital data and deletes', async () => {
    const db = dbAs(env, 'superAdmin');
    await assertFails(db.doc('hospitals/bad1').set({ ...hospitalDoc(serverTs()), services: ['Spa'] }));
    await assertFails(db.doc('hospitals/bad2').set({ ...hospitalDoc(serverTs()), latitude: 200 }));
    await assertFails(db.doc('hospitals/bad3').set({ ...hospitalDoc(serverTs()), dohNetworked: 'yes' }));
    await assertFails(db.doc('hospitals/bad4').set({ ...hospitalDoc(serverTs()), extra: 1 }));
    await assertFails(db.doc('hospitals/hosp-1').delete());
  });

  it('non-super roles cannot write hospitals', async () => {
    await assertFails(dbAs(env, 'adminA').doc('hospitals/hosp-3').set(hospitalDoc(serverTs())));
    await assertFails(dbAs(env, 'midwifeA').doc('hospitals/hosp-1').update({ active: false, updatedAt: serverTs() }));
  });

  it('can create and update clinics, but not delete', async () => {
    const db = dbAs(env, 'superAdmin');
    await assertSucceeds(db.doc('clinics/clinic-c').set(clinicDoc(serverTs())));
    await assertSucceeds(db.doc(`clinics/${CLINIC_A}`).update({ active: false, updatedAt: serverTs() }));
    await assertFails(db.doc(`clinics/${CLINIC_A}`).delete());
  });

  it('clinic_admin may edit own clinic contact fields only', async () => {
    const db = dbAs(env, 'adminA');
    await assertSucceeds(db.doc(`clinics/${CLINIC_A}`).update({ contactNumber: '09170000000', bhwContactNumber: '09171111111', updatedAt: serverTs() }));
    await assertFails(db.doc(`clinics/${CLINIC_A}`).update({ active: false, updatedAt: serverTs() }));
    await assertFails(db.doc(`clinics/${CLINIC_A}`).update({ contactNumber: '09170000000' })); // updatedAt not request.time
    await assertFails(db.doc(`clinics/${CLINIC_B}`).update({ contactNumber: '09170000000', updatedAt: serverTs() }));
    await assertFails(db.doc('clinics/clinic-c').set(clinicDoc(serverTs())));
  });

  it('midwife cannot edit clinics', async () => {
    await assertFails(dbAs(env, 'midwifeA').doc(`clinics/${CLINIC_A}`).update({ contactNumber: '09170000000', updatedAt: serverTs() }));
  });
});
