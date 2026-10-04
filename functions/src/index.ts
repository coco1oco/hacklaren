// Cloud Functions entry point. Owned by mara-backend. All functions run in asia-southeast1.
import { setGlobalOptions } from 'firebase-functions/v2';
import { FUNCTIONS_REGION } from './shared/contracts';

setGlobalOptions({ region: FUNCTIONS_REGION, maxInstances: 10 });

// Callables (names match CALLABLES in shared/contracts.ts)
export { createReferral } from './referrals/createReferral';
export { generateSummary, sendReferral } from './referrals/summaryAndSend';
export { getReferralView, updateReferralStatus } from './referrals/hospital';
export { cancelReferral, revokeReferralLink, resendReferralLink, resendSms } from './referrals/manage';
export { generateReferralPdf } from './pdf/generateReferralPdf';
export { createStaffUser, setStaffActive } from './admin/staff';
export { registerClinic } from './admin/onboarding';
export { getReferralReport } from './admin/report';

export { processReferralRequestCallable as processReferralRequest } from './referrals/triggers';

// Firestore triggers
export { onReferralCreated, onReferralRequestCreated } from './referrals/triggers';

// Scheduled
export { scheduledCleanup } from './scheduled/cleanup';
