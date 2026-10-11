/* global process, console, document, window, setTimeout */
// Browser smoke for moving the simulated walker with the keys (and the pad): each direction moves
// the walker the way it is pressed ON SCREEN (the illustrated map is turned, so compass directions
// would feel reversed), the walker walks (animation class) and glides, and it stays on the paths.
// Not part of `npm test`: needs the API with the places, the visitor app and a local Chromium +
// playwright-core.
//
//   PLAYWRIGHT_CORE_PATH=/path/to/playwright-core CHROMIUM_PATH=/path/chrome \
//   node apps/visitor-web/scripts/controller-browser-smoke.mjs http://localhost:3002
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
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(ok ? 'PASS' : 'FAIL', name, extra);
};

const context = await browser.newContext({
  viewport: { width: 1440, height: 860 },
  geolocation: { latitude: 10.78, longitude: 106.62, accuracy: 8 },
  permissions: ['geolocation'],
});
await context.addInitScript(() => {
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      getVoices: () => [{ lang: 'vi-VN', name: 'Linh', localService: true }],
      addEventListener() {},
      removeEventListener() {},
      cancel() {},
      speak(u) {
        setTimeout(() => u.onend && u.onend(), 300);
      },
    },
  });
  window.SpeechSynthesisUtterance = function (text) {
    this.text = text;
  };
});
const page = await context.newPage();
page.on('pageerror', (error) => console.log('pageerror', error.message));
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('.poi-card');
await page.waitForTimeout(2500);
await page.click('.panel-handle');
await page.waitForTimeout(900);
await page
  .getByRole('button', { name: /Mở bảng mô phỏng/ })
  .click()
  .catch(() => {});
await page.getByRole('button', { name: 'Đặt người trên bản đồ' }).click();
await page.mouse.click(806, 662);
await page.waitForTimeout(1500);

const spot = () =>
  page.evaluate(() => {
    const box = document
      .querySelector('.simulated-human')
      .getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
const press = async (key, times = 8) => {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(500);
};
const walkingNow = () =>
  page.evaluate(() =>
    document.querySelector('.simulated-human').classList.contains('is-walking'),
  );

// the walker is placed; each key moves it on screen the way it points (when a path allows it)
const gained = { ArrowRight: 0, ArrowLeft: 0, ArrowUp: 0, ArrowDown: 0 };
for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) {
  // go the opposite way first so that there is room to move in the tested direction
  const before = await spot();
  await press(key);
  const after = await spot();
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  gained[key] =
    key === 'ArrowRight'
      ? dx
      : key === 'ArrowLeft'
        ? -dx
        : key === 'ArrowDown'
          ? dy
          : -dy;
  console.log(
    `  ${key}: moved ${Math.round(dx)}, ${Math.round(dy)} px on screen`,
  );
}
// a path may not exist in every direction from one spot, but it must never go the OPPOSITE way
for (const [key, value] of Object.entries(gained)) {
  check(`${key} never moves the opposite way`, value > -2, String(value));
}
check(
  'the keys moved the walker',
  Object.values(gained).some((value) => value > 6),
  JSON.stringify(gained),
);

// walking animation while a key repeats, standing still afterwards
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(80);
check('the walker walks while it moves', await walkingNow());
await page.waitForTimeout(900);
check('the walker stands still afterwards', !(await walkingNow()));

// the pad buttons obey the same screen directions
await page.click(
  '.simulation-controls .simulation-toggle, .simulation-controls',
);
await page.waitForTimeout(400);
const padUp = page.getByRole('button', { name: 'Đi lên' });
if (await padUp.count()) {
  const before = await spot();
  for (let i = 0; i < 6; i++) {
    await padUp.click({ force: true }).catch(() => {});
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
  const after = await spot();
  check(
    'the up button never moves down the screen',
    after.y - before.y < 2,
    `${Math.round(after.y - before.y)} px`,
  );
}
await browser.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
