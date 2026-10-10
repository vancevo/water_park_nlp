/* global process, console, document, window, localStorage, fetch, Buffer, HTMLMediaElement */
// Browser smoke for T25D/T03 + I01/I03 (narration locale selector). Not part of
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
// what the real narration endpoint resolved; when that narration has audio, the
// player must serve exactly the published bytes (sha256 of the playback URL),
// so object storage must be reachable from this process.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  // The card no longer embeds an <audio>: the shared player plays through one Audio element.
  // Record the sources it plays so the smoke can check what the visitor would hear.
  await context.addInitScript(() => {
    window.__playedSrc = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!this.src.startsWith('data:')) window.__playedSrc.push(this.src);
      return play.call(this);
    };
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

  // Most of the 77 places only have Vietnamese narration: open places until one has English.
  await select.selectOption('en');
  const cardCount = await page.locator('.poi-card').count();
  for (let index = 1; index < cardCount; index++) {
    const english = page.locator('.narration-body [lang="en"]');
    await page.waitForTimeout(700);
    if ((await english.count()) > 0) break;
    await page.locator('.poi-card').nth(index).click();
  }
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

  // The whole interface (not only POI content) switches language, keeps the
  // narration locale and survives a reload.
  await page.getByRole('button', { name: 'Interface in English' }).click();
  await page.getByLabel('Narration language').waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.match(
    await page.locator('.discovery-panel h1').innerText(),
    /Every step/,
  );
  assert.match(await page.locator('.list-heading').innerText(), /place/);
  assert.match(await page.locator('.account-button').innerText(), /Log in/);
  assert.equal(
    await page.locator('.narration-locale select').inputValue(),
    'en',
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.poi-card').first().click();
  assert.match(
    await page.locator('.discovery-panel h1').innerText(),
    /Every step/,
  );
  await page.getByRole('button', { name: 'Giao diện tiếng Việt' }).click();
  await page.getByLabel('Ngôn ngữ thuyết minh').waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'vi');
  assert.match(
    await page.locator('.discovery-panel h1').innerText(),
    /Mỗi bước chân/,
  );
  assert.equal(
    await page.locator('.narration-locale select').inputValue(),
    'en',
  );

  // Old / new map switch (small control by the zoom buttons) must not break the page.
  for (const label of ['Cũ', 'Mới']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    assert.equal(
      await page
        .getByRole('button', { name: label, exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
  }

  // Escape closes the POI card; reopen it for the rest of the run.
  await page.keyboard.press('Escape');
  await page.locator('.poi-detail').waitFor({ state: 'detached' });
  await page.locator('.poi-card').first().click();
  await page.locator('.poi-detail').waitFor();
  assert.doesNotMatch(
    await page.locator('.poi-card').first().innerText(),
    /Chưa xác định|Unknown/,
    'unknown distance is not shown in the list',
  );

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
    await page.locator('.narration-body .listen-row').waitFor();
    // No "AI-generated voice" chip is shown to the visitor (removed on request).
    assert.equal(
      await page.locator('.narration-body .ai-audio-label').count(),
      0,
    );
    assert.equal(
      await page.locator('.narration-body .secondary-action').innerText(),
      'Nghe thuyết minh',
      'one Listen button; recorded audio is played by the shared player',
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
    // Every locale: what the real endpoint resolved drives the fallback
    // notice, the transcript language and the audio played to the visitor.
    const withAudio = [];
    for (const option of [...catalog.locales.slice(1), catalog.locales[0]]) {
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
      if (resolved.fallbackUsed) {
        // Another language is never played under the chosen one: the card offers a switch.
        assert.match(
          await page.locator('.narration-body .secondary-action').innerText(),
          /^Nghe bản /,
          `${option.code}: fallback offers to switch language, not to play`,
        );
      } else if (resolved.audio) {
        const listen = page.locator(
          '.narration-bar .secondary-action:not(.stop-action)',
        );
        await listen.waitFor();
        assert.equal(
          await page.locator('.narration-body .ai-audio-label').count(),
          0,
          `${option.code}: no AI label chip`,
        );
        await page.evaluate(() => {
          window.__playedSrc = [];
        });
        await listen.click();
        await page.waitForFunction(() => window.__playedSrc.length > 0);
        const src = await page.evaluate(() => window.__playedSrc.at(-1));
        await page.getByRole('button', { name: 'Dừng', exact: true }).click();
        const bytes = Buffer.from(await (await fetch(src)).arrayBuffer());
        assert.equal(
          createHash('sha256').update(bytes).digest('hex'),
          resolved.audio.sha256,
          `${option.code}: player serves the published audio`,
        );
        withAudio.push(`${option.code}→${resolved.resolvedLocale}`);
      }
      remembered = option.code;
    }
    console.log(`audio checked: ${withAudio.join(', ') || 'none published'}`);
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
  if ((await reloaded.inputValue()) !== codes[0]) {
    // macOS Chromium opens a native popup instead of moving a closed select
    // with Home; type-ahead on the first option's label is still keyboard-only.
    const first = await reloaded.locator('option').first().innerText();
    await page.keyboard.press(first[0]);
  }
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
