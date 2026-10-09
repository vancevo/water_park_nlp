/* global process, console, document, fetch, Buffer */
// Browser smoke: an editor uploads an audio file from admin-web straight to
// object storage with the presigned PUT. A real browser enforces CORS, so this
// fails if the bucket/server does not allow the admin origin and the headers
// `content-type`, `x-amz-checksum-sha256`, `x-amz-meta-sha256`.
//
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... AUDIO_FILE=/path/to/file.wav \
//   PLAYWRIGHT_CORE_PATH=... CHROMIUM_PATH=... \
//   node apps/admin-web/scripts/audio-upload-browser-smoke.mjs http://localhost:3001 http://localhost:3000
//
// Needs the admin app built with NEXT_PUBLIC_API_BASE_URL=<api> and
// NEXT_PUBLIC_NARRATION_DATA_MODE=api. Creates one "[smoke]" draft and deletes
// it at the end. Credentials come from the environment and are never printed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { URL } from 'node:url';

const base = process.argv[2] ?? 'http://localhost:3001';
const apiBase = process.argv[3] ?? 'http://localhost:3000';
const { ADMIN_EMAIL, ADMIN_PASSWORD, AUDIO_FILE } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !AUDIO_FILE) {
  console.error('Set ADMIN_EMAIL, ADMIN_PASSWORD and AUDIO_FILE (a .wav).');
  process.exit(2);
}
const corePath = process.env.PLAYWRIGHT_CORE_PATH ?? 'playwright-core';
const { chromium } = await import(
  corePath.startsWith('/')
    ? pathToFileURL(path.join(corePath, 'index.mjs')).href
    : corePath
);
const expectedSha = createHash('sha256')
  .update(readFileSync(AUDIO_FILE))
  .digest('hex');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
});
const failures = [];
let token = '';
let narrationId = '';
try {
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 900 } })
  ).newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (error) => failures.push(error.message));
  const corsErrors = [];
  page.on('console', (message) => {
    if (/CORS|Access-Control/i.test(message.text()))
      corsErrors.push(message.text());
  });
  const puts = [];
  page.on('response', (response) => {
    if (
      response.request().method() === 'PUT' &&
      !response.url().startsWith(base)
    )
      puts.push(response.status());
  });

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', ADMIN_EMAIL);
  await page.fill('input[type=password]', ADMIN_PASSWORD);
  await page.click('button:has-text("Đăng nhập")');
  await page
    .locator('a[href^="/pois/"]:not([href="/pois/new"])')
    .first()
    .click();
  await page.locator('.narration-editor textarea').waitFor();
  const startNew = page.getByRole('button', { name: 'Tạo phiên bản mới' });
  if (await startNew.count()) await startNew.click();
  await page
    .locator('.narration-editor textarea')
    .fill(
      '[smoke] Bản thuyết minh kiểm tra tải audio từ trình duyệt lên kho lưu trữ.',
    );
  await page.locator('input[type=file]').setInputFiles(AUDIO_FILE);
  await page.getByLabel('Chủ sở hữu quyền').fill('Smoke test');
  await page.getByLabel('Nguồn nội dung').fill('Generated locally');
  await page.getByLabel('Phạm vi/quyền sử dụng').fill('Testing only');
  const saved = page.waitForResponse(
    (response) =>
      /\/v1\/admin\/(pois\/[^/]+\/narrations|narrations\/[^/]+)$/.test(
        new URL(response.url()).pathname,
      ) && ['POST', 'PATCH'].includes(response.request().method()),
  );
  await page.getByRole('button', { name: 'Lưu thuyết minh' }).click();
  try {
    await saved;
  } catch (error) {
    const note = await page
      .locator('[role=alert], [role=status]')
      .allInnerTexts()
      .catch(() => []);
    throw new Error(
      `save did not reach the API. PUT=${puts} cors=${corsErrors.join(' | ')} pageerrors=${failures.join(' | ')} ui=${note.join(' / ')}`,
      { cause: error },
    );
  }
  await page.waitForFunction(
    () => document.querySelector('.draft-audio'),
    null,
    {
      timeout: 30_000,
    },
  );

  assert.deepEqual(corsErrors, [], `CORS errors: ${corsErrors.join(' | ')}`);
  assert.deepEqual(puts, [200], 'browser PUT to storage returned 200');

  // Verify what the API stored against the file the browser sent.
  const login = await (
    await fetch(`${apiBase}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    })
  ).json();
  token = login.accessToken;
  const headers = { authorization: `Bearer ${token}` };
  const pois = await (await fetch(`${apiBase}/v1/pois`)).json();
  for (const poi of pois.items) {
    const list = await (
      await fetch(`${apiBase}/v1/admin/pois/${poi.id}/narrations`, { headers })
    ).json();
    const smoke = list.find((item) => item.transcript?.startsWith('[smoke]'));
    if (smoke) {
      narrationId = smoke.id;
      assert.equal(smoke.audio?.sha256, expectedSha);
      const playback = await (
        await fetch(
          `${apiBase}/v1/admin/narrations/${smoke.id}/audio/playback`,
          {
            headers,
          },
        )
      ).json();
      const bytes = Buffer.from(
        await (await fetch(playback.playbackUrl)).arrayBuffer(),
      );
      assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        expectedSha,
      );
      break;
    }
  }
  assert.ok(narrationId, 'uploaded draft found through the API');
  assert.deepEqual(failures, [], `page errors: ${failures.join(' | ')}`);
  console.log(
    'PASS admin audio upload smoke (browser → presigned PUT → storage)',
  );
} finally {
  if (narrationId && token) {
    await fetch(`${apiBase}/v1/admin/narrations/${narrationId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
  await browser.close();
}
