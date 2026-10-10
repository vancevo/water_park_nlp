/* global process, console, fetch */
// SHOT_DIR=/some/dir also writes screenshots of the list and the simulated measuring screen.
// Browser smoke for the /field simulation on the experimental place (real API + DB):
// the list leaves exactly that place "Chưa kiểm"; its screen shows a simulated GPS next to it,
// the measuring animation runs, and NOTHING is saved or moved. The "measure the gate" line is gone.
//
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... PLAYWRIGHT_CORE_PATH=... CHROMIUM_PATH=... \
//   node apps/admin-web/scripts/field-simulation-browser-smoke.mjs http://localhost:3001 http://localhost:3000
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
const get = async (pathname) =>
  (
    await fetch(`${apiBase}${pathname}`, {
      headers: { authorization: `Bearer ${login.accessToken}` },
    })
  ).json();
const poisBefore = await get('/v1/admin/pois');
const test = poisBefore.find((p) => p.slug === 'new-diem-thu');
const other = poisBefore.find((p) => p.slug.startsWith('p25-'));
assert.ok(test && other, 'needs the experimental place and place 25');
const checksBefore = (await get('/v1/admin/field-checks')).length;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
});
let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed += 1;
  console.log(ok ? 'PASS' : 'FAIL', name, extra);
};
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    // A real GPS far away: the simulation must ignore it.
    geolocation: { latitude: 10.7, longitude: 106.6, accuracy: 8 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', ADMIN_EMAIL);
  await page.fill('input[type=password]', ADMIN_PASSWORD);
  await page.click('button:has-text("Đăng nhập")');
  await page.locator('.auth-session b', { hasText: ADMIN_EMAIL }).waitFor();
  await page.goto(`${base}/field`, { waitUntil: 'networkidle' });
  await page.locator('.field-progress').waitFor();

  // list: only the experimental place is left to check
  await page.locator('.field-row').first().waitFor();
  const todo = await page.locator('.field-row').allInnerTexts();
  check(
    'list: one place left unchecked',
    todo.length === 1,
    String(todo.length),
  );
  const progress = await page.locator('.field-progress b').innerText();
  const [done, total] = progress.split('/').map(Number);
  check('list: all the others count as checked', total - done === 1, progress);

  if (process.env.SHOT_DIR)
    await page.screenshot({ path: `${process.env.SHOT_DIR}/f-list.png` });
  // the experimental place: simulated GPS next to it
  await page.locator('.field-row').first().click();
  await page.locator('.field-map').waitFor();
  check(
    'no simulation banner',
    (await page.locator('.alert.sim').count()) === 0,
  );
  const where = await page.locator('.field-where').innerText();
  check(
    'position card shows a spot a few metres away',
    /\d m/.test(where) && !/Đang chờ GPS/.test(where),
    where.replace(/\n/g, ' '),
  );
  check(
    'GPS badge is good',
    /tốt/.test(await page.locator('.field-gps').innerText()),
  );
  check(
    'no "measure the gate" line',
    (await page.getByRole('button', { name: /Đo cổng/ }).count()) === 0,
  );
  check(
    '"report a problem" is there',
    (await page.getByRole('button', { name: /Báo vấn đề/ }).count()) === 1,
  );

  // report a problem: note box shows, still nothing to save
  await page.getByRole('button', { name: /Báo vấn đề/ }).click();
  await page.locator('.field-card.draft textarea').waitFor();
  check(
    'problem report: note box, nothing to save',
    (await page
      .getByRole('button', { name: /Chỉ lưu kết quả|Lưu và cập nhật/ })
      .count()) === 0,
  );
  await page.getByRole('button', { name: 'Xong' }).click();

  // measuring animation
  await page
    .getByRole('button', { name: /Đo vị trí địa điểm tại đây/ })
    .click();
  await page.locator('.field-card.measure .field-radar').waitFor();
  await page.waitForTimeout(2500);
  if (process.env.SHOT_DIR)
    await page.screenshot({ path: `${process.env.SHOT_DIR}/f-measure.png` });
  const mid = await page.locator('.field-card.measure').innerText();
  check(
    'measuring card shows progress',
    /mẫu tốt/.test(mid),
    mid.replace(/\n/g, ' ').slice(0, 90),
  );
  await page.locator('.field-card.draft').waitFor({ timeout: 20_000 });
  const draft = await page.locator('.field-card.draft').innerText();
  check(
    'result: small offset, simulation note',
    /lệch [0-9,.]+ m/.test(draft) && /Mô phỏng/.test(draft),
    draft.replace(/\n/g, ' ').slice(0, 120),
  );
  check(
    'result: nothing to save',
    (await page
      .getByRole('button', { name: /Chỉ lưu kết quả|Lưu và cập nhật/ })
      .count()) === 0,
  );
  await page.getByRole('button', { name: 'Xong' }).click();
  check(
    'done closes the result',
    (await page.locator('.field-card.draft').count()) === 0,
  );

  // a normal place: no gate line either
  await page.goto(`${base}/field/${other.id}`, { waitUntil: 'networkidle' });
  await page
    .getByRole('button', { name: /Đo vị trí địa điểm tại đây/ })
    .waitFor();
  check(
    'normal place: no "measure the gate" line',
    (await page.getByRole('button', { name: /Đo cổng/ }).count()) === 0,
  );
  check(
    'normal place: not a simulation',
    (await page.locator('.alert.sim').count()) === 0,
  );
  check('no page errors', errors.length === 0, errors.join('; '));
} finally {
  await browser.close();
}

const after = (await get('/v1/admin/pois')).find((p) => p.id === test.id);
check(
  'the real position did not move',
  after.location.latitude === test.location.latitude &&
    after.location.longitude === test.location.longitude,
);
check(
  'no field check was saved',
  (await get('/v1/admin/field-checks')).length === checksBefore,
);
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
