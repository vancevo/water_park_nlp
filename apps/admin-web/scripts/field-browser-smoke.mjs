/* global process, console, fetch, localStorage, window, Event */
// Browser smoke for the phone-first field verification screens (real API + DB):
//  list by distance → open a place → measure (fake GPS) → "Lưu và cập nhật luôn" moves the
//  POI in place (still published) → measure at the original spot while OFFLINE → the
//  result queues on the device → back online it uploads and is applied from the review screen.
//
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... PLAYWRIGHT_CORE_PATH=... CHROMIUM_PATH=... \
//   node apps/admin-web/scripts/field-browser-smoke.mjs http://localhost:3001 http://localhost:3000
//
// The place is restored at the end. Geolocation is faked by Playwright (no GPS needed).
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

async function api(pathname, token, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  return {
    status: response.status,
    json: await response.json().catch(() => null),
  };
}

const login = await (
  await fetch(`${apiBase}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
).json();
const token = login.accessToken;
const pois = (await api('/v1/admin/pois', token)).json;
const poi = pois.find((item) => item.status === 'published');
assert.ok(poi, 'needs a published POI');
const original = { ...poi.location };
const offset = (metres) => ({
  latitude: original.latitude + metres / 110_574,
  longitude: original.longitude,
});

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
});
const failures = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation: { ...offset(120), accuracy: 6 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => failures.push(error.message));

  // Hold a position for a few seconds, like a person standing still (GPS keeps reporting).
  async function stand(point, seconds = 9) {
    for (let i = 0; i < seconds; i += 1) {
      await context.setGeolocation({
        latitude: point.latitude + (i % 2 ? 1e-7 : -1e-7),
        longitude: point.longitude,
        accuracy: 6 + (i % 3),
      });
      await sleep(1000);
    }
  }

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', ADMIN_EMAIL);
  await page.fill('input[type=password]', ADMIN_PASSWORD);
  await page.click('button:has-text("Đăng nhập")');
  await page.locator('.auth-session b', { hasText: ADMIN_EMAIL }).waitFor();
  await page.goto(`${base}/field`, { waitUntil: 'networkidle' });

  // 1) The list shows progress and how far each place is.
  await page.locator('.field-progress').waitFor();
  await page.getByRole('button', { name: 'Tất cả' }).click();
  const name = poi.translations.find((t) => t.locale === 'vi').name;
  const row = page.locator('.field-row', { hasText: name });
  await row.waitFor();
  assert.match(await row.innerText(), /m về hướng/);

  // 2) Measure at a spot ~35 m from the saved position and apply it right away.
  await row.click();
  await page.locator('.field-map').waitFor();
  await stand(offset(0)); // the GPS has a fix before measuring
  const spot = offset(35);
  await page
    .getByRole('button', { name: /Đo vị trí địa điểm tại đây/ })
    .click();
  await stand(spot);
  await page.locator('.field-card.draft').waitFor();
  assert.match(
    await page.locator('.field-card.draft').innerText(),
    /lệch 3\d m/,
  );
  await page.getByRole('button', { name: 'Lưu và cập nhật luôn' }).click();
  await page
    .locator('.alert[role=status]', { hasText: 'Đã cập nhật vị trí địa điểm' })
    .waitFor();
  let now = (await api('/v1/admin/pois', token)).json.find(
    (item) => item.id === poi.id,
  );
  assert.equal(now.status, 'published', 'applying keeps the place published');
  assert.ok(
    Math.abs(now.location.latitude - spot.latitude) < 5e-6,
    'moved to the measured spot',
  );
  const publicList = await (await fetch(`${apiBase}/v1/pois?locale=vi`)).json();
  assert.ok(
    publicList.items.some((item) => item.id === poi.id),
    'visitors still see it',
  );

  // 3) Offline: measure back at the original position; it queues, then uploads on reconnect.
  await context.setOffline(true);
  await page
    .getByRole('button', { name: /Đo vị trí địa điểm tại đây/ })
    .click();
  await stand(original);
  await page.locator('.field-card.draft').waitFor();
  await page
    .getByRole('button', { name: 'Chỉ lưu kết quả' })
    .or(page.getByRole('button', { name: 'Lưu và cập nhật luôn' }))
    .first()
    .click();
  await page
    .locator('.alert[role=status]', { hasText: 'Đã lưu trên máy' })
    .waitFor();
  assert.ok(
    (
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem('damsen.admin.fieldQueue.v1') ?? '[]'),
      )
    ).length >= 1,
    'queued on the device',
  );
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('damsen.admin.fieldQueue.v1') ?? '[]')
        .length === 0,
  );
  const open = (
    await api(`/v1/admin/field-checks?poiId=${poi.id}&applied=false`, token)
  ).json;
  assert.equal(
    open.length,
    1,
    'the offline check reached the server exactly once',
  );

  // 4) Review screen: apply it (restores the original position).
  await page.goto(`${base}/field/review`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Áp dụng vị trí đo' }).first().click();
  await page
    .locator('.alert[role=status]', { hasText: 'Đã cập nhật vị trí' })
    .waitFor();
  now = (await api('/v1/admin/pois', token)).json.find(
    (item) => item.id === poi.id,
  );
  assert.ok(
    Math.abs(now.location.latitude - original.latitude) < 5e-6,
    'restored',
  );
  assert.deepEqual(failures, [], `page errors: ${failures.join(' | ')}`);
  console.log(
    'PASS field verification smoke (measure → apply → offline queue → review)',
  );
} finally {
  // Safety net: put the place back where it was.
  const current = (await api('/v1/admin/pois', token)).json.find(
    (item) => item.id === poi.id,
  );
  if (
    current &&
    Math.abs(current.location.latitude - original.latitude) > 5e-6
  ) {
    console.error('warning: position not restored automatically');
  }
  await browser.close();
}
