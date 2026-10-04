/**
 * Makes an account a MARA super admin on the LIVE project (manages clinics + hospital directory; no patient access).
 * Creates the Auth user if it does not exist.
 *
 *   npx tsx scripts/bootstrap-super-admin.ts <email> "<Full Name>" [password]
 *
 * Reads .secrets/firebase-service-account.json. Password is only used when creating a new user.
 */
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

const [email, name, password] = process.argv.slice(2);
if (!email || !name) {
  console.error('Usage: npx tsx scripts/bootstrap-super-admin.ts <email> "<Full Name>" [password]');
  process.exit(1);
}
for (const k of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) delete process.env[k];
const sa = JSON.parse(readFileSync(process.env.SERVICE_ACCOUNT_PATH ?? '.secrets/firebase-service-account.json', 'utf8'));
const app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
const auth = getAuth(app);
const db = getFirestore(app);

let user = await auth.getUserByEmail(email).catch(() => null);
if (!user) {
  if (!password || password.length < 8) {
    console.error('User does not exist yet: pass a password (min 8 chars) to create it.');
    process.exit(1);
  }
  user = await auth.createUser({ email, password, displayName: name, emailVerified: true });
  console.log(`created auth user ${email}`);
}
await auth.setCustomUserClaims(user.uid, { role: 'super_admin', clinicId: null });
const now = Timestamp.now();
await db.collection('midwives').doc(user.uid).set(
  { uid: user.uid, name, email, contactNumber: '', clinicId: null, role: 'super_admin', active: true, createdAt: now, updatedAt: now },
  { merge: true },
);
await auth.revokeRefreshTokens(user.uid); // forces a fresh token with the new role on next sign-in
console.log(`${email} is now a MARA super admin on ${sa.project_id}. Sign in again to pick up the role.`);
