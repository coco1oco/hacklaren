import { expect, test } from '@playwright/test';
import { SEED_PATIENT } from './helpers';

// Revoked/expired tokens are covered by backend unit tests; this checks the unauthenticated UI path.
test.describe('hospital link', () => {
  for (const token of ['A'.repeat(43), 'not-a-token', 'x']) {
    test(`invalid token "${token.slice(0, 8)}…" shows no patient data`, async ({ page }) => {
      await page.goto(`/referral/${token}`);
      await expect(page.getByText(/invalid|expired|revoked|not (valid|available)|no longer/i).first()).toBeVisible();
      await expect(page.getByText(SEED_PATIENT.name)).toHaveCount(0);
      await expect(page.getByText(SEED_PATIENT.id)).toHaveCount(0);
      for (const action of ['ACKNOWLEDGE', 'DECLINE', 'PATIENT ARRIVED', 'DOWNLOAD PDF']) {
        await expect(page.getByRole('button', { name: action })).toHaveCount(0);
      }
      // Must not redirect to the staff login.
      await expect(page).toHaveURL(new RegExp(`/referral/`));
    });
  }
});
