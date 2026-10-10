/* global process, console, document */
// Browser smoke: the POI form can take the device's location, show it on the
// map, switch the category and snap an entrance to the nearest path node.
//
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... PLAYWRIGHT_CORE_PATH=... CHROMIUM_PATH=... \
//   node apps/admin-web/scripts/poi-geolocate-browser-smoke.mjs http://localhost:3001
//
// The browser's geolocation is faked (Playwright), so no GPS is needed; it saves
// nothing (the form is never submitted). SCREENSHOT=/path.png keeps a picture.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3001';
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
const FIX = { latitude: 10.7660312, longitude: 106.6381944, accuracy: 7 };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
});
const failures = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1300, height: 1000 },
    permissions: ['geolocation'],
    geolocation: FIX,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (error) => failures.push(error.message));

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', ADMIN_EMAIL);
  await page.fill('input[type=password]', ADMIN_PASSWORD);
  await page.click('button:has-text("Đăng nhập")');
  await page.goto(`${base}/pois/new`, { waitUntil: 'networkidle' });

  // 1) Use the device location for the POI.
  await page
    .getByRole('button', { name: /Dùng vị trí hiện tại/ })
    .first()
    .click();
  const poiCard = page.locator('.panel.card', { hasText: 'Vị trí POI' });
  await page.waitForFunction(
    (lat) =>
      [...document.querySelectorAll('input[type=number]')].some(
        (input) => Number(input.value) === lat,
      ),
    FIX.latitude,
  );
  assert.equal(
    await poiCard.locator('input[type=number]').nth(1).inputValue(),
    String(FIX.longitude),
  );
  assert.match(
    await poiCard.locator('.geo-note').innerText(),
    /sai số khoảng 7 m/,
  );

  // 2) The map shows the POI marker.
  await page.locator('.poi-map .map-pin.poi').waitFor();
  await page.locator('.poi-map canvas').waitFor();

  // 3) Clicking the map moves the POI.
  await page.locator('.poi-map').scrollIntoViewIfNeeded();
  const box = await page.locator('.poi-map canvas').boundingBox();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.waitForFunction(
    (lat) =>
      ![...document.querySelectorAll('input[type=number]')].some(
        (input) => Number(input.value) === lat,
      ),
    FIX.latitude,
  );

  // 4) The type can be a gate, a ride or a stage.
  const category = page.getByLabel('Loại địa điểm');
  const options = await category.locator('option').allInnerTexts();
  for (const wanted of ['Cổng', 'Trò chơi', 'Sân khấu / Biểu diễn']) {
    assert.ok(options.includes(wanted), `category option ${wanted}`);
  }
  await category.selectOption('gate');
  assert.equal(await category.inputValue(), 'gate');

  // 5) An entrance takes the device location and snaps to the nearest path node.
  await page.getByRole('button', { name: '+ Thêm cổng' }).click();
  const entrance = page.locator('.entrance-card').first();
  await entrance.getByRole('button', { name: /Dùng vị trí hiện tại/ }).click();
  await entrance.locator('.geo-note').filter({ hasText: 'sai số' }).waitFor();
  await entrance
    .getByRole('button', { name: 'Gắn vào đường gần nhất' })
    .click();
  await entrance
    .locator('.geo-note')
    .filter({ hasText: 'Đã gắn vào osm-' })
    .waitFor();
  assert.match(
    await entrance.locator('input[value^="osm-"]').inputValue(),
    /^osm-\d+$/,
  );

  if (process.env.SCREENSHOT) {
    await page.locator('.poi-map').scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.SCREENSHOT, fullPage: true });
  }
  assert.deepEqual(failures, [], `page errors: ${failures.join(' | ')}`);
  console.log('PASS admin POI geolocation + map + snap smoke');
} finally {
  await browser.close();
}
