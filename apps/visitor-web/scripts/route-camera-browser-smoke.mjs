/* global process, console, document, fetch */
// Browser smoke for the route camera (PLAN_4): a real GPS walk along a route (GPS mocked, one fix
// per second, 30 m per step), checking that the camera follows, throttles, hands over to the
// visitor's hand, comes back on "Follow me", frames the whole route once, asks for a new route when
// the visitor leaves it, and stops at the destination. Run twice: default (desktop) and MOBILE=1.
// Not part of `npm test`: needs the API (places 01 and 26, routing graph), the visitor app and a
// local Chromium + playwright-core.
//
//   PLAYWRIGHT_CORE_PATH=/path/to/playwright-core CHROMIUM_PATH=/path/chrome [MOBILE=1] \
//   node apps/visitor-web/scripts/route-camera-browser-smoke.mjs http://localhost:3002 [http://localhost:3000]
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = process.argv[2] ?? 'http://localhost:3002';
const apiBase = process.argv[3] ?? 'http://localhost:3000';
const corePath = process.env.PLAYWRIGHT_CORE_PATH ?? 'playwright-core';
const { chromium } = await import(
  corePath.startsWith('/')
    ? pathToFileURL(path.join(corePath, 'index.mjs')).href
    : corePath
);
const api = apiBase;
const pois = (await (await fetch(`${api}/v1/pois`)).json()).items;
const gate = pois.find((p) => p.slug.startsWith('p01-'));
const dest = pois.find((p) => p.slug.startsWith('p26-'));
// the route the app will get, to walk along it
const entrance = JSON.parse(
  await (await fetch(`${api}/v1/pois/${gate.id}`)).text(),
).entrances[0].location;
const routeRes = await (
  await fetch(`${api}/v1/routes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      from: { lat: entrance.latitude, lng: entrance.longitude },
      poiId: dest.id,
      accessible: false,
    }),
  })
).json();
const line = routeRes.geometry.coordinates;
const R = 6371008.8,
  rad = Math.PI / 180;
const dist = (a, b) => {
  const dl = (b[1] - a[1]) * rad,
    dg = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dl / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dg / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const cum = [0];
for (let i = 1; i < line.length; i++)
  cum.push(cum[i - 1] + dist(line[i - 1], line[i]));
const total = cum.at(-1);
const at = (m) => {
  m = Math.min(Math.max(0, m), total);
  for (let i = 1; i < line.length; i++)
    if (cum[i] >= m) {
      const r = (m - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      return [
        line[i - 1][0] + (line[i][0] - line[i - 1][0]) * r,
        line[i - 1][1] + (line[i][1] - line[i - 1][1]) * r,
      ];
    }
  return line.at(-1);
};
console.log('route length', Math.round(total), 'm,', line.length, 'vertices');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: [
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
let failed = 0;
const check = (n, ok, x = '') => {
  if (!ok) failed++;
  console.log(ok ? 'PASS' : 'FAIL', n, x);
};
const vp = process.env.MOBILE
  ? { width: 390, height: 844 }
  : { width: 1366, height: 768 };
const context = await browser.newContext({
  viewport: vp,
  hasTouch: !!process.env.MOBILE,
  isMobile: !!process.env.MOBILE,
  geolocation: { latitude: line[0][1], longitude: line[0][0], accuracy: 8 },
  permissions: ['geolocation'],
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
let routeCalls = 0;
page.on('request', (r) => {
  if (r.url().endsWith('/v1/routes') && r.method() === 'POST') routeCalls++;
});
const setPos = (m, off = 0) => {
  const p = at(m);
  return context.setGeolocation({
    latitude: p[1] + off / 110574,
    longitude: p[0],
    accuracy: 8,
  });
};
const mode = () =>
  page.evaluate(() => document.querySelector('.map-canvas').dataset.cameraMode);
const zoom = () =>
  page.evaluate(() =>
    Number(document.querySelector('.map-canvas').dataset.cameraZoom),
  );
const moves = () =>
  page.evaluate(() =>
    Number(document.querySelector('.map-canvas').dataset.cameraMoves ?? 0),
  );
const userInView = () =>
  page.evaluate(() => {
    const u = document.querySelector('.user-location');
    const c = document.querySelector('.map-canvas').getBoundingClientRect();
    if (!u) return null;
    const b = u.getBoundingClientRect();
    const x = b.x + b.width / 2,
      y = b.y + b.height / 2;
    const covered = [
      ...document.querySelectorAll('.poi-detail,.simulation-body'),
    ].some((e) => {
      const r = e.getBoundingClientRect();
      return x > r.left && x < r.right && y > r.top && y < r.bottom;
    });
    return {
      inside: x > c.left && x < c.right && y > c.top && y < c.bottom,
      covered,
      rx: (x - c.left) / c.width,
      ry: (y - c.top) / c.height,
    };
  });
const tick = async (m, ms = 1000) => {
  await setPos(m);
  await page.waitForTimeout(ms);
};

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
// open the destination and ask for directions
await page.evaluate(
  (n) =>
    [...document.querySelectorAll('.map-pin')]
      .find((e) => e.textContent.trim() === n)
      ?.click(),
  '26',
);
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /Dẫn đường từ vị trí/ }).click();
await page.waitForTimeout(3500);
// Like a maps app: the route opens as a whole, from here to the destination.
check(
  'route created: whole-route preview',
  (await mode()) === 'overview',
  await mode(),
);
// The visitor is in view; the destination may sit inside a cluster, so its pin is not asked for.
const previewUser = await page.evaluate(() => {
  const c = document.querySelector('.map-canvas').getBoundingClientRect();
  const b = document.querySelector('.user-location')?.getBoundingClientRect();
  return Boolean(
    b &&
      b.x > c.left + 20 &&
      b.right < c.right - 20 &&
      b.y > c.top + 20 &&
      b.bottom < c.bottom - 20,
  );
});
check('preview shows the visitor, clear of the edges', previewUser);
const zPreview = await zoom();
check(
  'preview is not zoomed in too far',
  (await zoom()) <= 17.9,
  String(await zoom()),
);
// the visitor starts walking: after 25+ m the camera follows
await tick(40, 1500);
await tick(70, 1500);
check(
  'walking starts: the camera follows',
  (await mode()) === 'follow',
  await mode(),
);
const z0 = await zoom();
check('zoom in the walking range', z0 >= 16.5 && z0 <= 18.7, String(z0));
check(
  'walking view is closer than the preview',
  z0 > zPreview,
  `${zPreview} -> ${z0}`,
);
// walk: 30 m per second (fast test), checking the visitor stays in view
let outOfView = 0,
  covered = 0,
  samples = 0;
const m0 = await moves();
for (let m = 0; m < total - 60; m += 30) {
  await tick(m, 1000);
  const v = await userInView();
  if (v) {
    samples++;
    if (!v.inside) outOfView++;
    if (v.covered) covered++;
  }
}
const m1 = await moves();
check(
  'visitor stays in view all along',
  samples > 5 && outOfView === 0,
  `samples=${samples} out=${outOfView}`,
);
check('visitor never under a card or panel', covered === 0);
check(
  'camera moves are throttled, not one per GPS tick',
  m1 - m0 < (total / 30) * 1.0 + 4,
  `moves=${m1 - m0} ticks=${Math.round(total / 30)}`,
);

// drag by hand -> free; GPS ticks do not take the camera back
const box = await page.locator('.map-canvas').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(
  box.x + box.width / 2 + 140,
  box.y + box.height / 2 + 90,
  { steps: 8 },
);
await page.mouse.up();
await page.waitForTimeout(500);
check(
  'dragging the map stops following',
  (await mode()) === 'free',
  await mode(),
);
const movesFree = await moves();
await tick(total - 200, 1500);
await tick(total - 160, 1500);
check(
  'free camera is not pulled back by GPS ticks',
  (await moves()) === movesFree,
);
await page.getByRole('button', { name: 'Theo tôi' }).click();
await page.waitForTimeout(1200);
check(
  '"Follow me" returns to following',
  (await mode()) === 'follow',
  await mode(),
);
// whole route
await page.getByRole('button', { name: 'Toàn tuyến' }).click();
await page.waitForTimeout(1200);
const zOverview = await zoom();
check(
  'whole route: overview mode',
  (await mode()) === 'overview',
  await mode(),
);
const mv = await moves();
await tick(total - 120, 1500);
check(
  'overview is not pulled back by GPS ticks',
  (await moves()) === mv && Math.abs((await zoom()) - zOverview) < 0.01,
);
await page.getByRole('button', { name: 'Theo tôi' }).click();
await page.waitForTimeout(1200);

// off route: 60 m away for > 5 s asks for a new route
const callsBefore = routeCalls;
await setPos(total - 150, 60);
await page.waitForTimeout(1500);
for (let i = 0; i < 4; i++) {
  await setPos(total - 150, 60);
  await page.waitForTimeout(1800);
}
check(
  'leaving the route asks for a new one',
  routeCalls > callsBefore,
  `calls ${callsBefore}->${routeCalls}`,
);

// arrival
await tick(total - 40, 1200);
await setPos(total - 8);
await page.waitForTimeout(1500);
await setPos(total - 5);
await page.waitForTimeout(2500);
check(
  'arriving stops the automatic camera and says so',
  (await mode()) === 'arrived',
  await mode(),
);
const ma = await moves();
await setPos(total - 3);
await page.waitForTimeout(2000);
check('no camera moves after arriving', (await moves()) === ma);
console.log(failed === 0 ? 'ALL PASS' : failed + ' FAILED');
await browser.close();
