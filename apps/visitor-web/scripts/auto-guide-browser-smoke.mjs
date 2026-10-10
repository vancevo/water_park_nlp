/* global process, console, document, window, performance, fetch, HTMLMediaElement, setInterval, clearInterval, setTimeout */
// Browser smoke for the click / GPS / audio rules (PLAN_1): one shared player, no overlap,
// no replay of what was heard. Not part of `npm test`: it needs the API with places 25 and 26
// published WITH audio (they are the only ones with a narration so far), the visitor app on
// :3002 and a local Chromium + playwright-core.
//
//   PLAYWRIGHT_CORE_PATH=/path/to/playwright-core CHROMIUM_PATH=/path/chrome \
//   node apps/visitor-web/scripts/auto-guide-browser-smoke.mjs http://localhost:3002 [http://localhost:3000]
//
// A: visitor far away (click rules, switch on/off). B: GPS near 25 (starts once after the stay,
// never replays). C: GPS candidate waits for audio the visitor started, then plays once.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3002';
const apiBase = process.argv[3] ?? 'http://localhost:3000';
const corePath = process.env.PLAYWRIGHT_CORE_PATH ?? 'playwright-core';
const { chromium } = await import(
  corePath.startsWith('/')
    ? pathToFileURL(path.join(corePath, 'index.mjs')).href
    : corePath
);
const pois = (await (await fetch(`${apiBase}/v1/pois`)).json()).items;
const p25 = pois.find((p) => p.slug.startsWith('p25-'));
const near25 = {
  latitude: p25.location.latitude + 0.0004,
  longitude: p25.location.longitude,
  accuracy: 10,
};
const far = { latitude: 10.77, longitude: 106.63, accuracy: 10 };
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(ok ? 'PASS' : 'FAIL', name, extra);
};
async function session(geo) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    geolocation: geo,
    permissions: ['geolocation'],
  });
  // The zone introductions use the browser voice, which headless Chromium lacks: a stand-in
  // that "speaks" for 400 ms.
  await context.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [{ lang: 'vi-VN', name: 'Linh', localService: true }],
        addEventListener() {},
        removeEventListener() {},
        cancel() {},
        speak(u) {
          setTimeout(() => u.onstart && u.onstart(), 10);
          setTimeout(() => u.onend && u.onend(), 400);
        },
      },
    });
    window.SpeechSynthesisUtterance = function (text) {
      this.text = text;
    };
  });
  await context.addInitScript(() => {
    window.__log = [];
    const o = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!this.src.startsWith('data:'))
        window.__log.push([
          Math.round(performance.now() / 100) / 10,
          this.src.split('/').pop().slice(0, 8),
        ]);
      return o.call(this);
    };
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  const timer = setInterval(
    () => context.setGeolocation(geo).catch(() => {}),
    2000,
  );
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  return {
    context,
    page,
    stop: () => clearInterval(timer),
    plays: () => page.evaluate(() => window.__log.length),
    bar: () =>
      page.evaluate(
        () => document.querySelector('.audio-bar-title')?.textContent ?? null,
      ),
    pin: (n) =>
      page.evaluate(
        (n) =>
          [...document.querySelectorAll('.map-pin')]
            .find((e) => e.textContent.trim() === n)
            ?.click(),
        n,
      ),
  };
}

// Part A: visitor far from every place (GPS cannot interfere)
{
  const t = await session(far);
  await t.page.getByRole('button', { name: 'Bật tự động' }).click();
  await t.pin('25');
  await t.page.waitForTimeout(1500);
  check(
    'A1 click (auto on) plays an unheard place',
    (await t.plays()) === 1 && /Đu quay/.test((await t.bar()) ?? ''),
    await t.bar(),
  );
  await t.pin('25');
  await t.pin('25');
  await t.page.waitForTimeout(800);
  check(
    'A2 clicking the playing place does not restart it',
    (await t.plays()) === 1,
  );
  await t.pin('26');
  await t.page.waitForTimeout(1500);
  check(
    'A3 click on another unheard place switches audio',
    (await t.plays()) === 2 && /Xe điện/.test((await t.bar()) ?? ''),
    await t.bar(),
  );
  // turn auto off: auto-origin audio stops
  await t.page.getByRole('button', { name: 'Tắt tự động' }).click();
  await t.page.waitForTimeout(500);
  check('A4 auto off stops the click-started audio', (await t.bar()) === null);
  await t.pin('25');
  await t.page.waitForTimeout(1000);
  check('A5 click with auto off only opens the card', (await t.plays()) === 2);
  await t.page
    .getByRole('button', { name: /^(Nghe thuyết minh|Nghe lại)$/ })
    .click();
  await t.page.waitForTimeout(1200);
  await t.page.getByRole('button', { name: 'Bật tự động' }).click();
  await t.page.waitForTimeout(300);
  await t.page.getByRole('button', { name: 'Tắt tự động' }).click();
  await t.page.waitForTimeout(300);
  check(
    'A6 manual audio survives toggling auto',
    /Đu quay/.test((await t.bar()) ?? ''),
    await t.bar(),
  );
  t.stop();
  await t.context.close();
}

// Part B: GPS near place 25
{
  const t = await session(near25);
  await t.page.getByRole('button', { name: 'Bật tự động' }).click();
  await t.page.waitForTimeout(5500);
  check(
    'B1 standing near 25 starts it once after the stay',
    (await t.plays()) === 1 && /Đu quay/.test((await t.bar()) ?? ''),
    `plays=${await t.plays()} bar=${await t.bar()}`,
  );
  await t.page.waitForTimeout(18000);
  check(
    'B2 staying there never replays it',
    (await t.plays()) === 1,
    `plays=${await t.plays()}`,
  );
  t.stop();
  await t.context.close();
}

// Part C: GPS candidate waits for audio the visitor started, then plays
{
  const t = await session(near25);
  await t.pin('26');
  await t.page.waitForTimeout(500);
  await t.page.getByRole('button', { name: 'Nghe thuyết minh' }).click();
  await t.page.waitForTimeout(800);
  await t.page.getByRole('button', { name: 'Bật tự động' }).click();
  await t.page.waitForTimeout(5000);
  check(
    'C1 GPS does not interrupt audio the visitor started',
    /Xe điện/.test((await t.bar()) ?? ''),
    `plays=${await t.plays()} bar=${await t.bar()}`,
  );
  await t.page.waitForTimeout(16000);
  const log = await t.page.evaluate(() => window.__log.map((x) => x[1]));
  check(
    'C2 after it finishes the waiting place plays once',
    log.filter((x) => x.startsWith('5909')).length === 1,
    JSON.stringify(log),
  );
  t.stop();
  await t.context.close();
}
await browser.close();
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
