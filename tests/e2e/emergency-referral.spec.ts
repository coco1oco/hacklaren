import { expect, test } from '@playwright/test';
import { captureHospitalLink, chooseHospital, login, openAsHospital, openPatient, SEED_HOSPITAL, SEED_PATIENT } from './helpers';

test.describe('emergency referral', () => {
  test('sends immediately, link works without auth, summary arrives asynchronously, hospital records arrival', async ({ page, browser }) => {
    await login(page);
    await openPatient(page, SEED_PATIENT.name);

    await test.step('send emergency referral', async () => {
      await page.getByRole('button', { name: 'EMERGENCY REFERRAL' }).or(page.getByRole('link', { name: 'EMERGENCY REFERRAL' })).first().click();
      await chooseHospital(page, SEED_HOSPITAL);
      await page.getByRole('radio', { name: /severe bleeding/i }).or(page.getByRole('button', { name: /severe bleeding/i })).first().click();
      await page.getByRole('button', { name: 'SEND IMMEDIATELY' }).click();
    });

    await test.step('status SENT shown immediately (not waiting on AI)', async () => {
      await expect(page.getByText(/\bSENT\b/).first()).toBeVisible({ timeout: 10_000 });
    });

    const link = await captureHospitalLink(page);
    const hospital = await openAsHospital(browser, link);

    await test.step('hospital view loads without auth', async () => {
      await expect(hospital.getByText(new RegExp(SEED_PATIENT.name, 'i')).first()).toBeVisible();
      await expect(hospital.getByText(/emergency/i).first()).toBeVisible();
      // Emergency referrals have no decline workflow.
      await expect(hospital.getByRole('button', { name: 'DECLINE' })).toHaveCount(0);
    });

    await test.step('AI summary appears asynchronously', async () => {
      await expect
        .poll(
          async () => {
            await hospital.reload();
            // Wait for the view to render (lazy chunk + callable) before counting, otherwise the poll races the load.
            await hospital.getByRole('heading', { name: 'Q Summary' }).waitFor({ timeout: 15_000 });
            return hospital.getByText(/AI summary generated after referral transmission/i).count();
          },
          { timeout: 60_000, intervals: [2_000, 3_000, 5_000] },
        )
        .toBeGreaterThan(0);
    });

    await test.step('ACKNOWLEDGE → PATIENT ARRIVED', async () => {
      await hospital.getByRole('button', { name: 'ACKNOWLEDGE' }).click();
      await expect(hospital.getByText(/acknowledged/i).first()).toBeVisible();
      await hospital.getByRole('button', { name: 'PATIENT ARRIVED' }).click();
      await expect(hospital.getByText(/arrived/i).first()).toBeVisible();
      await expect(hospital.getByRole('button', { name: 'ACKNOWLEDGE' })).toHaveCount(0);
      await expect(hospital.getByRole('button', { name: 'PATIENT ARRIVED' })).toHaveCount(0);
    });

    await test.step('clinic sees arrival', async () => {
      await expect(page.getByText(/arrived/i).first()).toBeVisible({ timeout: 20_000 });
    });

    await hospital.context().close();
  });
});
