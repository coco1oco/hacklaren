import { expect, test } from '@playwright/test';
import { captureHospitalLink, chooseHospital, login, openAsHospital, SEED_HOSPITAL, uniqueSuffix } from './helpers';

test.describe('checkup referral (full flow)', () => {
  test('patient → visit → AI summary review → send → hospital acknowledges → realtime status → PDF', async ({ page, browser }) => {
    const patientName = `E2E Checkup ${uniqueSuffix()}`;

    await test.step('login', async () => {
      await login(page);
    });

    await test.step('create patient', async () => {
      await page.goto('/patients/new');
      await page.getByLabel(/^full name|^name/i).first().fill(patientName);
      await page.getByLabel(/birth ?date|date of birth/i).fill('1995-04-12');
      await page.getByLabel(/^address/i).fill('1 E2E Street');
      await page.getByLabel(/barangay/i).first().fill('Barangay Test');
      await page.getByLabel(/^(patient )?(contact|mobile)( number)?$/i).first().fill('09171234567');
      await page.getByLabel(/emergency contact name/i).fill('E2E Relative');
      await page.getByLabel(/relationship/i).fill('Spouse');
      await page.getByLabel(/emergency contact (number|mobile)/i).fill('09181234567');
      await page.getByLabel(/LMP|last menstrual/i).fill('2026-03-10');
      await page.getByLabel(/EDD|expected (date of )?delivery/i).fill('2026-12-15');
      await page.getByLabel(/gravida/i).fill('2');
      await page.getByLabel(/^para/i).fill('1');
      const bloodType = page.getByLabel(/blood type/i);
      if (await bloodType.count()) await bloodType.selectOption('O+');
      await page.getByLabel(/patient consents to sharing/i).check();
      await page.getByRole('button', { name: /save|create|register/i }).click();
      // Re-runs reuse the same phone number, so duplicate detection may (correctly) prompt first.
      const continueAnyway = page.getByRole('button', { name: /continue anyway/i });
      const heading = page.getByRole('heading', { name: new RegExp(patientName, 'i') }).first();
      await expect(continueAnyway.or(heading)).toBeVisible();
      if (await continueAnyway.isVisible()) await continueAnyway.click();
      await expect(heading).toBeVisible();
    });

    await test.step('create visit', async () => {
      await page.getByRole('link', { name: /new visit|add visit|record visit/i }).or(page.getByRole('button', { name: /new visit|add visit|record visit/i })).first().click();
      await page.getByLabel(/visit date/i).fill('2026-10-01');
      await page.getByLabel(/systolic/i).fill('148');
      await page.getByLabel(/diastolic/i).fill('94');
      await page.getByLabel(/weight/i).fill('62');
      await page.getByLabel(/FHR|fetal heart/i).fill('140');
      await page.getByRole('textbox', { name: /add to medications/i }).fill('Ferrous sulfate');
      await page.getByRole('textbox', { name: /add to medications/i }).press('Enter');
      await page.getByRole('button', { name: /save/i }).click();
      await expect(page.getByText('148/94').first()).toBeVisible();
    });

    await test.step('create checkup referral', async () => {
      await page.getByRole('link', { name: /^checkup referral$/i }).or(page.getByRole('button', { name: /^checkup referral$/i })).first().click();
      await chooseHospital(page, SEED_HOSPITAL);
      await page.getByLabel(/reason/i).fill('Elevated BP recorded at last visit. For OB evaluation.');
      await page.getByRole('button', { name: /create referral|continue|next/i }).click();
    });

    await test.step('generate + review summary', async () => {
      const generate = page.getByRole('button', { name: /generate (ai )?summary/i });
      if (await generate.isVisible().catch(() => false)) await generate.click();
      await expect(page.getByText(/AI-GENERATED/).first()).toBeVisible();
      await expect(page.getByText(/MIDWIFE REVIEW REQUIRED/i).first()).toBeVisible();
      const send = page.getByRole('button', { name: /send referral|^send$/i });
      await expect(send).toBeDisabled();
      await page.getByLabel(/I have reviewed/i).check();
      await expect(send).toBeEnabled();
      await send.click();
    });

    const link = await test.step('capture hospital link', async () => {
      await expect(page.getByText(/\bSENT\b/).first()).toBeVisible();
      return captureHospitalLink(page);
    });

    await test.step('hospital acknowledges (no auth)', async () => {
      const hospital = await openAsHospital(browser, link);
      await expect(hospital.getByText(new RegExp(patientName, 'i')).first()).toBeVisible();
      await expect(hospital.getByText(/MIDWIFE-REVIEWED/).first()).toBeVisible();
      await expect(hospital.getByRole('button', { name: 'DECLINE' })).toBeVisible();
      await expect(hospital.getByRole('link', { name: /CALL REFERRING MIDWIFE/ }).or(hospital.getByRole('button', { name: /CALL REFERRING MIDWIFE/ })).first()).toBeVisible();
      await hospital.getByRole('button', { name: 'ACKNOWLEDGE' }).click();
      await expect(hospital.getByText(/acknowledged/i).first()).toBeVisible();
      await hospital.context().close();
    });

    await test.step('clinic sees ACKNOWLEDGED in realtime', async () => {
      await expect(page.getByText(/ACKNOWLEDGED/i).first()).toBeVisible({ timeout: 20_000 });
    });

    await test.step('download PDF', async () => {
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: /DOWNLOAD PDF/i }).first().click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    });
  });
});
