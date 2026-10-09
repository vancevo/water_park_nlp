/* global process, console, document, window, localStorage, fetch */
// Browser smoke for T25D/T03 + I01 (narration locale selector). Not part of
// `npm test`: it needs a running visitor web app and a local Chromium +
// playwright-core.
//
//   SMOKE_MODE=demo|api PLAYWRIGHT_CORE_PATH=/path/to/node_modules/playwright-core \
//   CHROMIUM_PATH=/path/to/chrome \
//   node apps/visitor-web/scripts/narration-browser-smoke.mjs http://localhost:3002 [http://localhost:3000]
//
// SMOKE_MODE=demo (default; app built with NEXT_PUBLIC_NARRATION_DATA_MODE=demo)
// checks the fixture catalog VI/EN/FR, the FR → EN fallback and that recorded
// audio wins over browser TTS. SMOKE_MODE=api (app built with `api`) checks the
// select against the real `GET /v1/narration-locales` (second argument = API
// base) and, for any locale with a fallback, that the fallback notice matches
// what the real narration endpoint resolved.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3002';
const apiBase = process.argv[3] ?? 'http://localhost:3000';
const mode = process.env.SMOKE_MODE === 'api' ? 'api' : 'demo';
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
  // Record what the real narration endpoint returned to the app, per locale.
  page.on('response', async (response) => {
    const match = /\/narration\?locale=([^&]+)/.exec(response.url());
    if (!match) return;
    const body = response.ok() ? await response.json().catch(() => null) : null;
    await page
      .evaluate(
        ([code, value]) => {
          window.__smokeNarrations = {
            ...window.__smokeNarrations,
            [code]: value,
          };
        },
        [decodeURIComponent(match[1]), body],
      )
      .catch(() => {});
  });
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

  // Locale whose preference is checked after reload.
  let remembered = 'en';
  if (mode === 'demo') {
    assert.deepEqual(codes, ['vi', 'en', 'fr']);
    await select.selectOption('fr');
    await page.locator('.fallback-notice').waitFor();
    assert.match(
      await page.locator('.fallback-notice').innerText(),
      /Français/,
    );
    // Demo fixture: VI carries recorded audio, so it wins over browser TTS.
    await select.selectOption('vi');
    await page.locator('.narration-body audio').waitFor();
    assert.equal(
      await page.locator('.narration-body .secondary-action').count(),
      0,
      'no browser-TTS button when recorded audio exists',
    );
    await select.selectOption('fr');
    await page.locator('.fallback-notice').waitFor();
    remembered = 'fr';
  } else {
    const catalog = await fetch(`${apiBase}/v1/narration-locales`).then(
      (response) => response.json(),
    );
    assert.deepEqual(
      codes,
      catalog.locales.map((option) => option.code),
      'select mirrors the configured catalog',
    );
    // Every non-default locale: what the real endpoint resolved drives the
    // fallback notice and the transcript language shown to the visitor.
    for (const option of catalog.locales.slice(1)) {
      await select.selectOption(option.code);
      await page.waitForFunction(
        (code) => window.__smokeNarrations?.[code] !== undefined,
        option.code,
      );
      const resolved = await page.evaluate(
        (code) => window.__smokeNarrations[code],
        option.code,
      );
      if (!resolved) continue; // 404: no published narration in the chain
      await page
        .locator(`.narration-body [lang="${resolved.resolvedLocale}"]`)
        .first()
        .waitFor();
      const notice = page.locator('.fallback-notice');
      if (resolved.fallbackUsed) {
        await notice.waitFor();
        assert.match(await notice.innerText(), new RegExp(option.nativeLabel));
      } else assert.equal(await notice.count(), 0);
      remembered = option.code;
    }
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
  assert.equal(await reloaded.inputValue(), remembered);
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
  console.log(`PASS visitor narration smoke (${mode}: ${codes.join(', ')})`);
} finally {
  await browser.close();
}
