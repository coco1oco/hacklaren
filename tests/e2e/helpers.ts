import { expect, type Browser, type Page } from '@playwright/test';

export const MIDWIFE = { email: 'midwife@mara.test', password: 'Password123!' };
export const SEED_PATIENT = { name: 'Maria Santos', id: 'MARA-PAT-2841' };
export const SEED_HOSPITAL = 'Provincial Hospital';

/** Hospital links look like {origin}/referral/{43-char base64url token}. */
export const HOSPITAL_LINK = /https?:\/\/[^\s"'<>]+\/referral\/[A-Za-z0-9_-]{43}/;

export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(MIDWIFE.email);
  await page.getByLabel(/password/i).fill(MIDWIFE.password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function openPatient(page: Page, name: string): Promise<void> {
  await page.goto('/patients');
  const search = page.getByRole('searchbox').or(page.getByLabel(/search/i)).first();
  if (await search.isVisible().catch(() => false)) await search.fill(name);
  await page.getByRole('link', { name: new RegExp(name, 'i') }).first().click();
  await expect(page.getByRole('heading', { name: new RegExp(name, 'i') }).first()).toBeVisible();
}

/** Picks a hospital from either a native <select>, a radio list, or a list of buttons. */
export async function chooseHospital(page: Page, hospital: string): Promise<void> {
  const select = page.getByLabel(/hospital/i).first();
  if ((await select.count()) && (await select.evaluate((el) => el.tagName === 'SELECT'))) {
    await select.selectOption({ label: hospital }).catch(async () => {
      const value = await select.locator('option', { hasText: hospital }).first().getAttribute('value');
      await select.selectOption(value ?? '');
    });
    return;
  }
  await page.getByRole('radio', { name: new RegExp(hospital, 'i') }).or(page.getByRole('button', { name: new RegExp(hospital, 'i') })).first().click();
}

/** Reads the hospital link from the page: link href, input value, or visible text. */
export async function captureHospitalLink(page: Page): Promise<string> {
  let found: string | null = null;
  await expect
    .poll(
      async () => {
        found = await page.evaluate((source) => {
          const re = new RegExp(source);
          for (const a of Array.from(document.querySelectorAll('a[href]'))) {
            const m = (a as HTMLAnchorElement).href.match(re);
            if (m) return m[0];
          }
          for (const i of Array.from(document.querySelectorAll('input, textarea'))) {
            const m = (i as HTMLInputElement).value.match(re);
            if (m) return m[0];
          }
          return document.body.innerText.match(re)?.[0] ?? null;
        }, HOSPITAL_LINK.source);
        return found;
      },
      { message: 'hospital link should be shown after sending' },
    )
    .not.toBeNull();
  return found as unknown as string;
}

/** Opens the hospital link in a brand-new context (no Firebase Auth session). */
export async function openAsHospital(browser: Browser, url: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

export function uniqueSuffix(): string {
  return Date.now().toString(36).toUpperCase();
}
