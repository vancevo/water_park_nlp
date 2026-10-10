/* global process, console, fetch, sessionStorage */
// Browser smoke: add a place on site (/field/new), see it in the moderation queue, approve it,
// then add another, send the draft to review, reject it with a reason. Real API + DB.
//
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... PLAYWRIGHT_CORE_PATH=... CHROMIUM_PATH=... \
//   node apps/admin-web/scripts/review-browser-smoke.mjs http://localhost:3001 http://localhost:3000
//
// Geolocation is faked. The test places are removed at the end (published → draft → rejected → deleted).
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
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
const { chromium } = await import(
  corePath.startsWith('/')
    ? pathToFileURL(path.join(corePath, 'index.mjs')).href
    : corePath
);

const login = await (
  await fetch(`${apiBase}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
).json();
async function api(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(pathname.startsWith('/v1/admin')
        ? { authorization: `Bearer ${login.accessToken}` }
        : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  return {
    status: response.status,
    json: await response.json().catch(() => null),
  };
}

const SPOT = { latitude: 10.7655, longitude: 106.6382, accuracy: 6 };
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
});
const failures = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1300, height: 1000 },
    permissions: ['geolocation'],
    geolocation: SPOT,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => failures.push(error.message));

  async function addPlace(name, buttonName) {
    await page.goto(`${base}/field/new`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Đo vị trí tại đây/ }).waitFor();
    await page.getByRole('button', { name: /Đo vị trí tại đây/ }).click();
    for (let i = 0; i < 9; i += 1) {
      await context.setGeolocation({
        latitude: SPOT.latitude + (i % 2 ? 1e-7 : -1e-7),
        longitude: SPOT.longitude,
        accuracy: 6 + (i % 3),
      });
      await sleep(1000);
    }
    await page.getByLabel('Tên tiếng Việt (bắt buộc)').fill(name);
    await page.getByLabel('Loại địa điểm').selectOption('food');
    await page.getByRole('button', { name: buttonName }).click();
    await page.locator('.alert[role=status]').waitFor();
  }

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', ADMIN_EMAIL);
  await page.fill('input[type=password]', ADMIN_PASSWORD);
  await page.click('button:has-text("Đăng nhập")');
  await page.waitForFunction(() =>
    sessionStorage.getItem('damsen.admin.session.v1'),
  );

  // 1) Add on site and send for review.
  await addPlace('Smoke Duyệt 1', 'Lưu và gửi duyệt');
  assert.match(
    await page.locator('.alert[role=status]').innerText(),
    /Đã gửi duyệt/,
  );

  // 2) The sidebar shows how many are waiting; the queue lists it.
  await page.goto(`${base}/review`, { waitUntil: 'networkidle' });
  await page.locator('.nav-badge').waitFor();
  const card = page.locator('.review-card', { hasText: 'Smoke Duyệt 1' });
  await card.waitFor();
  assert.match(await card.innerText(), /Ăn uống/);

  // 3) Approve → visible to visitors.
  await card.getByRole('button', { name: 'Duyệt', exact: true }).click();
  await page.locator('.alert[role=status]', { hasText: 'Đã duyệt' }).waitFor();
  const visible = await api('/v1/pois?locale=vi');
  assert.ok(
    visible.json.items.some((item) => item.name === 'Smoke Duyệt 1'),
    'published for visitors',
  );

  // 4) Another place: save as draft, send it from the queue, reject with a reason.
  await addPlace('Smoke Duyệt 2', 'Chỉ lưu nháp');
  await page.goto(`${base}/review`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /Bản nháp/ }).click();
  const draft = page.locator('.review-card', { hasText: 'Smoke Duyệt 2' });
  await draft.getByRole('button', { name: 'Gửi duyệt' }).click();
  await page
    .locator('.alert[role=status]', { hasText: 'Đã gửi duyệt' })
    .waitFor();
  await page.getByRole('tab', { name: /Chờ duyệt/ }).click();
  const pending = page.locator('.review-card', { hasText: 'Smoke Duyệt 2' });
  await pending.getByRole('button', { name: 'Từ chối…' }).click();
  const confirm = pending.getByRole('button', { name: 'Xác nhận từ chối' });
  assert.equal(await confirm.isDisabled(), true, 'a reason is required');
  await pending.getByLabel(/Lý do từ chối/).fill('Sai vị trí, đo lại');
  await confirm.click();
  await page
    .locator('.alert[role=status]', { hasText: 'Đã từ chối' })
    .waitFor();
  await page.getByRole('tab', { name: /Bị từ chối/ }).click();
  assert.match(
    await page
      .locator('.review-card', { hasText: 'Smoke Duyệt 2' })
      .innerText(),
    /Sai vị trí, đo lại/,
  );
  assert.deepEqual(failures, [], `page errors: ${failures.join(' | ')}`);
  console.log(
    'PASS review queue smoke (add on site → approve → draft → submit → reject)',
  );
} finally {
  // Remove the test places: published ones go back to draft, get rejected, then deleted.
  const list = (await api('/v1/admin/pois')).json;
  for (const poi of list.filter((item) =>
    item.slug.startsWith('field-smoke-duyet'),
  )) {
    let current = poi;
    if (current.status === 'published') {
      current = (
        await api(`/v1/admin/pois/${poi.id}`, {
          method: 'PATCH',
          body: { category: 'food' },
        })
      ).json;
    }
    if (current.status === 'draft') {
      current = (
        await api(`/v1/admin/pois/${poi.id}/submit`, {
          method: 'POST',
          body: {},
        })
      ).json;
    }
    if (current.status === 'pending_review') {
      await api(`/v1/admin/content/${current.pendingVersionId}/reject`, {
        method: 'POST',
        body: { reason: 'dọn dẹp smoke test' },
      });
    }
    await api(`/v1/admin/pois/${poi.id}`, { method: 'DELETE' });
  }
  await browser.close();
}
