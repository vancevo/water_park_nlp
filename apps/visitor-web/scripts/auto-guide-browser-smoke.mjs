/* global process, console, document, window, HTMLMediaElement */
// Browser smoke for the proximity auto narration + fixed POI numbers. Needs the
// API with the 50 POIs and narrations for #25/#26, the visitor app on :3002 and
// a local Chromium + playwright-core (same setup as narration-browser-smoke).
//
//   PLAYWRIGHT_CORE_PATH=/path/to/playwright-core CHROMIUM_PATH=/path/chrome \
//   node apps/visitor-web/scripts/auto-guide-browser-smoke.mjs http://localhost:3002
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3002';
const corePath = process.env.PLAYWRIGHT_CORE_PATH ?? 'playwright-core';
const { chromium } = await import(
  corePath.startsWith('/')
    ? pathToFileURL(path.join(corePath, 'index.mjs')).href
    : corePath
);

const WHEEL = { latitude: 10.7642469, longitude: 106.636908 };
const BUMPER = { latitude: 10.7634211, longitude: 106.6380587 };
const metersNorth = (point, meters) => ({
  ...point,
  latitude: point.latitude + meters / 111_320,
});
const FAR = { latitude: 10.7668, longitude: 106.6349 };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
});
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    geolocation: { ...FAR, accuracy: 8 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.addInitScript(() => {
    window.__played = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__played.push(this.src.slice(0, 40));
      return play.call(this).catch(() => {});
    };
    window.__spoken = [];
    const speak = window.speechSynthesis?.speak?.bind(window.speechSynthesis);
    if (speak) {
      window.speechSynthesis.speak = (u) => {
        window.__spoken.push(u.text);
        return speak(u);
      };
    }
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.poi-card').first().waitFor();

  // Fixed numbers: 01..50, in order, no extra place.
  const numbers = await page.locator('.poi-card .poi-index').allTextContents();
  assert.equal(numbers.length, 50, `expected 50 places, got ${numbers.length}`);
  assert.deepEqual(
    numbers,
    Array.from({ length: 50 }, (_, i) => String(i + 1).padStart(2, '0')),
  );
  const names = (n) =>
    page.locator('.poi-card').nth(n).locator('.poi-copy strong').textContent();
  assert.equal(await names(24), 'Đu quay đứng');
  assert.equal(await names(25), 'Xe điện đụng thế hệ mới');
  console.log(
    '✓ list is 01–50 in map order; 25 = Đu quay đứng, 26 = Xe điện đụng thế hệ mới',
  );

  // Opting in with a far-away fix: distances shown, nothing plays.
  await page.getByRole('button', { name: /Bật tự động/ }).click();
  await page.locator('.auto-guide li small').first().waitFor();
  await page.waitForFunction(() =>
    /m|km/.test(
      document.querySelector('.auto-guide li small')?.textContent ?? '',
    ),
  );
  const farRows = await page.locator('.auto-guide li').allTextContents();
  console.log('✓ distances while far:', farRows.join(' | '));
  // List numbers must not change once the position is known (distance sort).
  const after = await page.locator('.poi-card .poi-index').allTextContents();
  assert.deepEqual(after, numbers, 'numbers changed after GPS fix');
  assert.equal(
    (await page.evaluate(() => window.__played.length)) +
      (await page.evaluate(() => window.__spoken.length)),
    // the opt-in tap itself primes audio/speech once
    2,
    'something narrated while far from both places',
  );
  console.log('✓ numbers unchanged with GPS; no narration while far');

  // Walk up to the Ferris wheel (8 m): narration starts without any tap.
  await context.setGeolocation({ ...metersNorth(WHEEL, 8), accuracy: 8 });
  await page.waitForFunction(
    () => window.__played.length + window.__spoken.length > 2,
    undefined,
    { timeout: 20_000 },
  );
  const card = await page
    .locator('.detail-card, .poi-detail')
    .first()
    .textContent()
    .catch(() => '');
  const played = await page.evaluate(() => window.__played.slice(1));
  const spoken = await page.evaluate(() => window.__spoken.slice(1));
  assert.ok(
    played.some((src) => !src.startsWith('data:audio/wav')) ||
      spoken.length > 0,
    'only the silent primer played',
  );
  console.log('✓ auto narration #25 →', {
    played,
    spoken: spoken.map((s) => s.slice(0, 40)),
  });
  assert.ok(
    (await page.locator('.auto-guide li.near').count()) >= 1,
    'near badge missing',
  );
  assert.ok(card !== undefined);

  // Same place again right away: no repeat.
  const count = await page.evaluate(
    () => window.__played.length + window.__spoken.length,
  );
  await context.setGeolocation({ ...metersNorth(WHEEL, 3), accuracy: 8 });
  await page.waitForTimeout(2500);
  assert.equal(
    await page.evaluate(() => window.__played.length + window.__spoken.length),
    count,
    'narrated twice',
  );
  console.log('✓ no repeat while staying at #25');

  // Poor accuracy at #26 must not trigger; a good fix then does.
  await context.setGeolocation({ ...metersNorth(BUMPER, 5), accuracy: 150 });
  await page.waitForTimeout(2500);
  assert.equal(
    await page.evaluate(() => window.__played.length + window.__spoken.length),
    count,
    'inaccurate fix triggered',
  );
  await context.setGeolocation({ ...metersNorth(BUMPER, 5), accuracy: 6 });
  await page.waitForFunction(
    (c) => window.__played.length + window.__spoken.length > c,
    count,
    { timeout: 20_000 },
  );
  console.log('✓ weak GPS ignored; #26 narrates on a good fix');
  await page.screenshot({
    path: process.env.SMOKE_SHOT ?? '/tmp/auto-guide.png',
  });
  console.log('PASS auto-guide-browser-smoke');
} finally {
  await browser.close();
}
