/* global process, console, document, window, localStorage */
// Browser smoke for T25D/T03 (narration locale selector). Not part of `npm test`:
// it needs a running visitor web app and a local Chromium + playwright-core.
//
//   PLAYWRIGHT_CORE_PATH=/path/to/node_modules/playwright-core \
//   CHROMIUM_PATH=/path/to/chrome \
//   node apps/visitor-web/scripts/narration-browser-smoke.mjs http://localhost:3002
//
// In demo mode (NEXT_PUBLIC_NARRATION_DATA_MODE=demo) it also checks the third
// locale (FR) and the fallback indicator. No network access beyond the app.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3002';
const corePath = process.env.PLAYWRIGHT_CORE_PATH ?? 'playwright-core';
let chromium;
try {
  ({ chromium } = await import(
    corePath.startsWith('/')
      ? pathToFileURL(path.join(corePath, 'index.mjs')).href
      : corePath
  ));
} catch {
  console.error(
    'playwright-core is not installed. Install it outside the repo and set PLAYWRIGHT_CORE_PATH.',
  );
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
});
const failures = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.poi-card').first().click();
  const select = page.getByLabel('Ngôn ngữ thuyết minh');
  await select.waitFor();
  await page.waitForFunction(
    () =>
      !document
        .querySelector('.narration-locale select')
        ?.hasAttribute('disabled'),
  );
  const codes = await select
    .locator('option')
    .evaluateAll((options) => options.map((option) => option.value));
  assert.ok(codes.includes('vi') && codes.includes('en'), `codes: ${codes}`);

  await select.selectOption('en');
  await page.locator('.narration-body [lang="en"]').first().waitFor();
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem('damsen.visitor.narrationLocale.v1'),
    ),
    'en',
  );
  // UI locale switch must not change the narration locale.
  await page.getByRole('button', { name: 'Giao diện tiếng Việt' }).click();
  assert.equal(await select.inputValue(), 'en');

  if (codes.includes('fr')) {
    await select.selectOption('fr');
    await page.locator('.fallback-notice').waitFor();
    assert.match(
      await page.locator('.fallback-notice').innerText(),
      /Français/,
    );
  }

  // Preference survives reload; keyboard can change the selection.
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.poi-card').first().click();
  const reloaded = page.getByLabel('Ngôn ngữ thuyết minh');
  await page.waitForFunction(
    () =>
      !document
        .querySelector('.narration-locale select')
        ?.hasAttribute('disabled'),
  );
  assert.equal(await reloaded.inputValue(), codes.includes('fr') ? 'fr' : 'en');
  await reloaded.focus();
  await page.keyboard.press('Home');
  assert.equal(await reloaded.inputValue(), codes[0]);

  // Blocked storage and phone width still work without horizontal scroll.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await phone.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('SecurityError');
      },
    }),
  );
  const mobile = await phone.newPage();
  mobile.on('pageerror', (error) => failures.push(`phone: ${error.message}`));
  await mobile.goto(base, { waitUntil: 'networkidle' });
  await mobile.locator('.poi-card').first().click();
  await mobile.getByLabel('Ngôn ngữ thuyết minh').waitFor();
  assert.ok(
    (await mobile.evaluate(() => document.documentElement.scrollWidth)) <= 390,
    'horizontal overflow at 390px',
  );
  assert.deepEqual(failures, []);
  console.log(`PASS visitor narration smoke (${codes.join(', ')})`);
} finally {
  await browser.close();
}
