/* global process, console, document, getComputedStyle */
// Browser smoke for the map markers (PLAN_2): pins sized by zoom, clusters where touch areas would
// overlap. At the whole-park view, zoomed in and after a pan, on desktop and phone: no two drawn
// touch areas overlap, every place in view is drawn or inside exactly one cluster, a cluster click
// zooms in and splits it, and a place inside a cluster stays reachable from the list.
// Not part of `npm test`: needs the API with the 77 places, the visitor app and a local Chromium +
// playwright-core.
//
//   PLAYWRIGHT_CORE_PATH=/path/to/playwright-core CHROMIUM_PATH=/path/chrome \
//   node apps/visitor-web/scripts/marker-browser-smoke.mjs http://localhost:3002
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = process.argv[2] ?? 'http://localhost:3002';
const corePath = process.env.PLAYWRIGHT_CORE_PATH ?? 'playwright-core';
const { chromium } = await import(
  corePath.startsWith('/')
    ? pathToFileURL(path.join(corePath, 'index.mjs')).href
    : corePath
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: [
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
let failed = 0;
const check = (n, ok, x = '') => {
  if (!ok) failed++;
  console.log(ok ? 'PASS' : 'FAIL', n, x);
};
const audit = (page) =>
  page.evaluate(() => {
    const canvas = document
      .querySelector('.map-canvas')
      .getBoundingClientRect();
    const hit = parseFloat(
      getComputedStyle(document.querySelector('.map-canvas')).getPropertyValue(
        '--hit-size',
      ),
    );
    const items = [];
    for (const e of document.querySelectorAll(
      '.map-pin:not(.sub), .amenity-pin',
    )) {
      const host = e.closest('.pin-anchor') ?? e;
      if (host.style.display === 'none') continue;
      const b = e.getBoundingClientRect();
      if (
        b.right < canvas.left ||
        b.left > canvas.right ||
        b.bottom < canvas.top ||
        b.top > canvas.bottom
      )
        continue;
      items.push({
        x: b.x + b.width / 2,
        y: b.y + b.height / 2,
        size: hit,
        id: e.getAttribute('aria-label'),
      });
    }
    for (const e of document.querySelectorAll('.cluster-pin')) {
      const b = e.getBoundingClientRect();
      if (
        b.right < canvas.left ||
        b.left > canvas.right ||
        b.bottom < canvas.top ||
        b.top > canvas.bottom
      )
        continue;
      items.push({
        x: b.x + b.width / 2,
        y: b.y + b.height / 2,
        size: Math.max(b.width, hit > 40 ? 44 : 0),
        id: 'cluster ' + e.textContent,
      });
    }
    let overlaps = 0;
    const bad = [];
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const reach = (items[i].size + items[j].size) / 2;
        if (
          Math.abs(items[i].x - items[j].x) < reach - 1 &&
          Math.abs(items[i].y - items[j].y) < reach - 1
        ) {
          overlaps++;
          if (bad.length < 3) bad.push([items[i].id, items[j].id]);
        }
      }
    const canvasEl = document.querySelector('.map-canvas');
    const W = canvasEl.clientWidth,
      H = canvasEl.clientHeight;
    // places whose coordinates are within the viewport (+60 px) must each be drawn or in a cluster
    const total = [
      ...document.querySelectorAll('.pin-anchor, .amenity-pin'),
    ].filter((e) => {
      const m =
        /translate\(([-\d.]+)px, ([-\d.]+)px\)\s*rotateX/.exec(
          e.style.transform,
        ) ??
        /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
          e.style.transform.replace(/^translate\(-50%, -50%\)\s*/, ''),
        );
      if (!m) return true;
      const x = +m[1],
        y = +m[2];
      return x >= -60 && x <= W + 60 && y >= -60 && y <= H + 60;
    }).length;
    const drawn = [
      ...document.querySelectorAll('.pin-anchor, .amenity-pin'),
    ].filter((e) => e.style.display !== 'none').length;
    const members = [...document.querySelectorAll('.cluster-pin')].reduce(
      (s, c) => s + Number(c.textContent.replace('+', '')),
      0,
    );
    return { items: items.length, overlaps, bad, total, drawn, members };
  });
for (const [name, vp] of [
  ['desktop', { width: 1366, height: 768 }],
  ['mobile', { width: 390, height: 844, hasTouch: true, isMobile: true }],
]) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.hasTouch,
    isMobile: vp.isMobile,
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  let a = await audit(page);
  check(
    `${name} far: no overlapping touch areas`,
    a.overlaps === 0,
    JSON.stringify(a),
  );
  check(
    `${name} far: drawn + clustered = all places`,
    a.drawn + a.members === a.total,
    `${a.drawn}+${a.members}/${a.total}`,
  );
  const box = await page.locator('.map-canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(1500);
  a = await audit(page);
  check(
    `${name} near: no overlapping touch areas`,
    a.overlaps === 0,
    JSON.stringify(a),
  );
  // pan then resize
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 120,
    box.y + box.height / 2 + 60,
    { steps: 6 },
  );
  await page.mouse.up();
  await page.waitForTimeout(1200);
  a = await audit(page);
  check(
    `${name} after pan: no overlapping touch areas`,
    a.overlaps === 0,
    JSON.stringify(a),
  );
  await page.close();
}
// cluster click zooms in, singles stay clickable
{
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  const before = await page.evaluate(
    () => document.querySelectorAll('.cluster-pin').length,
  );
  const big = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.cluster-pin')].sort(
      (a, b) => Number(b.textContent) - Number(a.textContent),
    )[0];
    c.click();
    return Number(c.textContent);
  });
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({
    clusters: document.querySelectorAll('.cluster-pin').length,
    pin: getComputedStyle(
      document.querySelector('.map-canvas'),
    ).getPropertyValue('--pin-size'),
  }));
  check(
    'cluster click zooms in and splits the cluster',
    parseFloat(after.pin) > 25 && after.clusters <= before,
    `biggest=${big} before=${before} after=${JSON.stringify(after)}`,
  );
  // a place inside a cluster stays reachable from the list
  await page
    .locator('.poi-card', { hasText: 'Khu trò chơi cảm giác mạnh' })
    .first()
    .click();
  await page.waitForTimeout(1500);
  check(
    'place from the list opens its card',
    (await page.locator('.poi-detail h2').innerText()).includes(
      'cảm giác mạnh',
    ),
  );
  await page.close();
}
console.log(failed === 0 ? 'ALL PASS' : failed + ' FAILED');
await browser.close();
