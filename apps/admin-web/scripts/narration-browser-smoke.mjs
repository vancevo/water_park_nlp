/* global process, console, document, sessionStorage, fetch */
// Browser smoke for T25C/T02 + AI04/T04 (locale tabs and AI generation UX).
// Not part of `npm test`: it needs the admin app built/started with
// NEXT_PUBLIC_NARRATION_DATA_MODE=demo and NEXT_PUBLIC_TTS_GENERATION_MODE=demo,
// the API with a dev admin account, and a local Chromium + playwright-core.
//
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... PLAYWRIGHT_CORE_PATH=... CHROMIUM_PATH=... \
//   node apps/admin-web/scripts/narration-browser-smoke.mjs http://localhost:3001 http://localhost:3000
//
// It creates one draft narration revision (marked "[smoke]") and deletes it at
// the end. Credentials come from the environment and are never printed.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3001';
const apiBase = process.argv[3] ?? 'http://localhost:3000';
const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD.');
  process.exit(2);
}
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(10_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const status = page.locator('.tts-status');
const waitForStatus = (pattern) =>
  page.waitForFunction(
    (source) =>
      new RegExp(source).test(
        document.querySelector('.tts-status')?.textContent ?? '',
      ),
    pattern.source,
    { timeout: 15_000 },
  );

try {
  await page.goto(`${base}/pois`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', ADMIN_EMAIL);
  await page.fill('input[type=password]', ADMIN_PASSWORD);
  await page.click('button:has-text("Đăng nhập")');
  await page
    .locator('a[href^="/pois/"]:not([href="/pois/new"])')
    .first()
    .click();
  const tabs = page.getByRole('tab');
  await tabs.first().waitFor();
  const labels = await tabs.allInnerTexts();
  assert.ok(
    labels.some((label) => label.includes('Français')),
    `${labels}`,
  );

  // Keyboard: Arrow/Home/End move selection and focus.
  await tabs.first().focus();
  await page.keyboard.press('End');
  assert.match(
    await page.locator('[role=tab][aria-selected=true]').innerText(),
    /Français/,
  );
  assert.match(
    await page.locator('.tts-generation').innerText(),
    /Lưu bản nháp thuyết minh trước/,
  );
  await page.keyboard.press('Home');

  const startNew = page.getByRole('button', { name: 'Tạo phiên bản mới' });
  if (await startNew.count()) await startNew.click();
  await page
    .locator('.narration-editor textarea')
    .fill('[smoke] Bản nháp kiểm thử luồng tạo audio AI, nội dung tổng hợp.');
  assert.ok(
    await page.getByRole('button', { name: 'Tạo audio AI' }).isDisabled(),
    'generation must wait for a saved transcript',
  );
  await page.getByRole('button', { name: 'Lưu thuyết minh' }).click();
  await page.getByRole('button', { name: 'Tạo audio AI' }).click();
  assert.equal(await status.getAttribute('aria-live'), 'polite');
  await waitForStatus(/Đang chờ|Đang tạo/);
  // A draft must not be saved or submitted while generation is in flight.
  const submit = page.getByRole('button', { name: 'Gửi duyệt' });
  const save = page.getByRole('button', { name: 'Lưu thuyết minh' });
  assert.ok(await submit.isDisabled(), 'submit blocked while job in flight');
  assert.ok(await save.isDisabled(), 'save blocked while job in flight');
  await waitForStatus(/^Đã tạo xong/);
  assert.ok(await submit.isEnabled(), 'submit allowed after success');
  assert.match(
    await page.locator('.tts-generation').innerText(),
    /AI-generated/,
  );
  assert.match(
    await page.locator('.tts-provenance').innerText(),
    /Phiên bản model/,
  );

  await page.getByRole('button', { name: 'Tạo lại audio AI' }).click();
  await waitForStatus(/Đang chờ|Đang tạo/);
  // Switching locale tabs remounts the editor; the running job is resumed.
  await page.locator('[role=tab][aria-selected=true]').focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  await waitForStatus(/Đang chờ|Đang tạo/);
  assert.ok(
    await page.getByRole('button', { name: 'Gửi duyệt' }).isDisabled(),
    'submit still blocked after tab switch',
  );
  await page.getByRole('button', { name: 'Huỷ tạo audio' }).click();
  await waitForStatus(/^Đã huỷ/);
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await waitForStatus(/^Đã tạo xong/);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390,
    'horizontal overflow at 390px',
  );
  assert.deepEqual(errors, []);
  console.log('PASS admin narration + AI generation smoke');
} finally {
  const token = await page
    .evaluate(
      () =>
        JSON.parse(sessionStorage.getItem('damsen.admin.session.v1') ?? '{}')
          .accessToken ?? '',
    )
    .catch(() => '');
  const poiId = page.url().split('/pois/')[1] ?? '';
  if (token && poiId) {
    const headers = { authorization: `Bearer ${token}` };
    const list = await fetch(`${apiBase}/v1/admin/pois/${poiId}/narrations`, {
      headers,
    }).then((response) => (response.ok ? response.json() : []));
    for (const item of list.filter(
      (narration) =>
        narration.status === 'draft' &&
        narration.transcript.startsWith('[smoke]'),
    ))
      await fetch(`${apiBase}/v1/admin/narrations/${item.id}`, {
        method: 'DELETE',
        headers,
      });
  }
  await browser.close();
}
