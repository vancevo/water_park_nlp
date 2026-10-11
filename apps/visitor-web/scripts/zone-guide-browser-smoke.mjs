/* global process, console, document, window, fetch, setInterval, setTimeout, clearInterval */
// Browser smoke for the zone introductions and the "where do you want to go" box. Not part of
// `npm test`: it needs the API with the 77 places, the visitor app and a local Chromium +
// playwright-core. The browser voice is replaced by a recorder, so no sound is needed.
//
//   PLAYWRIGHT_CORE_PATH=/path/to/playwright-core CHROMIUM_PATH=/path/chrome \
//   node apps/visitor-web/scripts/zone-guide-browser-smoke.mjs http://localhost:3002 [http://localhost:3000]
//
// A: auto narration switched on inside a zone -> the zone is named and the box asks what next;
//    an answer starts a route. B: walking into another zone speaks its introduction once and
//    shows the card; coming near it again plays it again. C: English narration speaks English.
// E: a single place narrates by itself when the visitor is near it (a service point too),
//    but not a toilet. D: the simulated walker, placed and walking, hears the zone it comes near.
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
const where = (prefix) => pois.find((p) => p.slug.startsWith(prefix)).location;
const at = (location, dLat = 0) => ({
  latitude: location.latitude + dLat,
  longitude: location.longitude,
  accuracy: 8,
});
const inThrill = at(where('p21-'), 0.00015);
const inGarden = at(where('p38-'), 0.0001);
const inZoneB = at(where('p46-'), 0.0001);
const farAway = { latitude: 10.78, longitude: 106.62, accuracy: 8 };

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

async function session(
  geo,
  init,
  viewport = { width: 1400, height: 900 },
  { noZones = false } = {},
) {
  const context = await browser.newContext({
    viewport,
    geolocation: geo,
    permissions: ['geolocation'],
  });
  await context.addInitScript(() => {
    window.__said = [];
    const voices = [
      { lang: 'vi-VN', name: 'Linh', localService: true },
      { lang: 'en-US', name: 'Samantha', localService: true },
    ];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => voices,
        addEventListener() {},
        removeEventListener() {},
        cancel() {},
        speak(u) {
          window.__said.push(u.text);
          setTimeout(() => u.onstart && u.onstart(), 10);
          setTimeout(() => u.onend && u.onend(), window.__speechMs ?? 400);
        },
      },
    });
    window.SpeechSynthesisUtterance = function (text) {
      this.text = text;
    };
  });
  if (init) await context.addInitScript(init);
  // Without zones the nearest place narrates by itself (inside a zone only the zone does).
  if (noZones) {
    await context.route(/\/data\/zones\.json/, (route) =>
      route.fulfill({ json: { zones: [] } }),
    );
  }
  // The places now have AI audio files; this smoke listens to the browser voice, so the
  // narration answers are served without audio (the audio path has its own checks).
  await context.route(/\/v1\/pois\/[^/]+\/narration/, async (route) => {
    const response = await route.fetch().catch(() => null);
    if (!response) return undefined;
    const body = await response.json().catch(() => null);
    if (!body) return route.fulfill({ response });
    return route.fulfill({ response, json: { ...body, audio: null } });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  let current = geo;
  const timer = setInterval(
    () => context.setGeolocation(current).catch(() => {}),
    1500,
  );
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.poi-card');
  await page.waitForTimeout(2500);
  return {
    context,
    page,
    move: (geo) => {
      current = geo;
      return context.setGeolocation(geo);
    },
    said: () => page.evaluate(() => window.__said.slice()),
    stop: () => clearInterval(timer),
  };
}
const toggleAuto = (page) =>
  page.getByRole('button', { name: /Bật tự động/ }).click();

// ---- A: switch on inside the thrill-ride zone
{
  const s = await session(inThrill);
  await toggleAuto(s.page);
  await s.page.locator('.next-stop').waitFor({ timeout: 10000 });
  const title = await s.page.locator('.next-stop h3').innerText();
  check(
    'A: box names the zone',
    /Khu trò chơi cảm giác mạnh/.test(title),
    title,
  );
  const buttons = await s.page.locator('.next-stop-options button').count();
  check('A: five choices', buttons === 5, String(buttons));
  check(
    'A: the box is in the left panel, not over the map',
    await s.page.evaluate(() => {
      const box = document.querySelector('.next-stop');
      return (
        Boolean(box?.closest('.discovery-panel')) && !box?.closest('.map-panel')
      );
    }),
  );
  check(
    'A: spoken: where you are and the question',
    (await s.said()).some((t) =>
      /Bạn đang ở Khu trò chơi cảm giác mạnh.*đi về\?/.test(t),
    ),
  );
  const noIntro = !(await s.said()).some((t) => /Bạn đang đến/.test(t));
  check('A: the welcomed zone is not introduced on top of it', noIntro);
  // An answer lists the fitting places in the search area (nearest first); the visitor picks one.
  const answer = (name) =>
    s.page.locator('.next-stop').getByRole('button', { name }).click();
  const listed = () =>
    s.page.locator('.poi-list .poi-card strong').allInnerTexts();
  await answer('Nhà vệ sinh');
  await s.page.waitForTimeout(800);
  const toilets = await listed();
  check(
    'A: an answer lists its places in the search area',
    toilets.length > 3 && toilets.every((name) => /vệ sinh/i.test(name)),
    toilets.slice(0, 2).join(' | '),
  );
  check(
    'A: the list is headed with the answer',
    /Gợi ý: Nhà vệ sinh/.test(
      await s.page.locator('.list-heading strong').innerText(),
    ),
  );
  check(
    'A: the box stays open to answer again',
    (await s.page.locator('.next-stop').count()) === 1,
  );
  // answering again replaces the list
  await answer('Đi ăn');
  await s.page.waitForTimeout(800);
  const food = await listed();
  check(
    'A: answering again lists the new places',
    food.length > 3 && !food.some((name) => /vệ sinh/i.test(name)),
    food.slice(0, 2).join(' | '),
  );
  check(
    'A: the chosen answer is marked',
    /Đi ăn/.test(
      await s.page
        .locator('.next-stop-options button[aria-pressed="true"]')
        .innerText(),
    ),
  );
  // picking a result opens the place, with the way to go there
  await s.page.locator('.poi-list .poi-card').first().click();
  await s.page.locator('.poi-detail').waitFor({ timeout: 8000 });
  check('A: a picked result opens its card', true);
  // typing a search ends the answer's list
  await s.page.locator('.search-box input').fill('Power');
  await s.page.waitForTimeout(1200);
  check(
    'A: typing a search replaces the answer list',
    /Kết quả tìm kiếm/.test(
      await s.page.locator('.list-heading strong').innerText(),
    ),
  );
  await s.page.locator('.search-box input').fill('');
  await s.page.waitForTimeout(600);
  await s.page.locator('.next-stop .close-button').click();

  // ---- B: walk into the garden zone
  await s.move(inGarden);
  await s.page.locator('.zone-card').waitFor({ timeout: 12000 });
  // The cards are in the left panel, never over the map.
  check(
    'B: the card is in the left panel, not over the map',
    await s.page.evaluate(() => {
      const card = document.querySelector('.zone-card');
      return (
        Boolean(card?.closest('.discovery-panel')) &&
        !card?.closest('.map-panel')
      );
    }),
  );
  await s.page.evaluate(() => (window.__speechMs = 400));
  const card = await s.page.locator('.zone-card h3').innerText();
  check('B: card of the new zone', /Khu vườn và Thủy cung/.test(card), card);
  const said = await s.said();
  check(
    'B: spoken intro: arrival, what is here, tip',
    said.some((t) =>
      /^Bạn đang đến Khu vườn và Thủy cung\..*Vườn xương rồng.*Không hái hoa/.test(
        t,
      ),
    ),
  );
  const intros = () =>
    s
      .said()
      .then(
        (all) => all.filter((t) => /^Bạn đang đến Khu vườn/.test(t)).length,
      );
  check('B: spoken once', (await intros()) === 1);
  await s.page.locator('.zone-card .close-button').click();
  check('B: card closes', (await s.page.locator('.zone-card').count()) === 0);
  await s.move(inThrill);
  await s.page.waitForTimeout(5000);
  await s.move(inGarden);
  await s.page.waitForTimeout(6000);
  check(
    'B: coming near the zone again plays it again',
    (await intros()) === 2,
    String(await intros()),
  );

  s.stop();
  await s.context.close();
}

// ---- C: English narration speaks English
{
  const s = await session(inThrill, () =>
    window.localStorage.setItem('damsen.visitor.narrationLocale.v1', 'en'),
  );
  await toggleAuto(s.page);
  await s.page.locator('.next-stop').waitFor({ timeout: 10000 });
  check(
    'C: English welcome',
    (await s.said()).some((t) =>
      /^You are in the Thrill Rides area\..*head home\?/.test(t),
    ),
    (await s.said())[0]?.slice(0, 60),
  );
  await s.page.locator('.next-stop .close-button').click();
  await s.page.evaluate(() => (window.__speechMs = 8000));
  await s.move(inZoneB);
  await s.page.waitForFunction(
    () => window.__said.some((t) => /^You are arriving at Zone B/.test(t)),
    null,
    { timeout: 15000 },
  );
  const english = (await s.said()).find((t) =>
    /^You are arriving at Zone B/.test(t),
  );
  check(
    'C: English intro',
    /roller coaster/.test(english) && /Haunted Castle/.test(english),
  );
  // A Stop button while it is spoken; the text stays for the visitor to read.
  await s.page.locator('.zone-card .zone-stop').waitFor({ timeout: 5000 });
  check('C: a Stop button while the introduction is spoken', true);
  await s.page.locator('.zone-card .zone-stop').click();
  await s.page.waitForTimeout(500);
  check(
    'C: Stop ends the audio but the text stays',
    (await s.page.locator('.zone-speaking').count()) === 0 &&
      (await s.page.locator('.zone-card').count()) === 1,
  );
  await s.page.waitForTimeout(9000);
  check(
    'C: the card is still there to read',
    (await s.page.locator('.zone-card').count()) === 1,
  );
  s.stop();
  await s.context.close();
}

// ---- Far from the park: no box, just a notice
{
  const s = await session(farAway);
  await toggleAuto(s.page);
  await s.page.waitForTimeout(4000);
  check('far away: no box', (await s.page.locator('.next-stop').count()) === 0);
  check(
    'far away: told they are not in the park',
    /chưa ở trong công viên/.test(await s.page.locator('.toast').innerText()),
  );
  s.stop();
  await s.context.close();
}

// ---- E: one narration per approach: the zone if there is one, else the nearest place only
{
  // Inside a zone the zone speaks and its places stay quiet.
  const s = await session(at(where('svc-parking-1'), 0.0001));
  await toggleAuto(s.page);
  await s.page.waitForTimeout(9000);
  const said = await s.said();
  check(
    'E: inside a zone the zone speaks',
    said.some((t) => /^Bạn đang ở /.test(t)),
  );
  check(
    'E: its places stay quiet',
    !said.some((t) => /^Bãi đậu xe số một/.test(t)),
  );
  s.stop();
  await s.context.close();
}
{
  // Outside every zone the nearest place speaks, every time the visitor comes near it.
  const s = await session(
    at(where('svc-parking-1'), 0.0001),
    undefined,
    { width: 1400, height: 900 },
    { noZones: true },
  );
  await toggleAuto(s.page);
  await s.page.waitForFunction(
    () => window.__said.some((t) => /^Bãi đậu xe số một/.test(t)),
    null,
    { timeout: 25000 },
  );
  check('E: without a zone the nearest place narrates', true);
  await s.move(at(where('svc-wc-3'), 0.00005));
  await s.page.waitForTimeout(9000);
  check(
    'E: a toilet never narrates by itself',
    !(await s.said()).some((t) => /^Nhà vệ sinh số/.test(t)),
  );
  const count = async () =>
    (await s.said()).filter((t) => /^Bãi đậu xe số một/.test(t)).length;
  const before = await count();
  await s.move(farAway);
  await s.page.waitForTimeout(8000);
  await s.move(at(where('svc-parking-1'), 0.0001));
  await s.page.waitForFunction(
    (n) => window.__said.filter((t) => /^Bãi đậu xe số một/.test(t)).length > n,
    before,
    { timeout: 25000 },
  );
  check('E: coming near it again plays it again, heard before or not', true);
  s.stop();
  await s.context.close();
}

// ---- D: the simulated walker walks into zones
{
  // The click below is placed for this window size (whole-park view).
  const s = await session(farAway, undefined, { width: 1440, height: 860 });
  const page = s.page;
  await page.click('.panel-handle');
  await page.waitForTimeout(900);
  await page
    .getByRole('button', { name: /Mở bảng mô phỏng/ })
    .click()
    .catch(() => {});
  await page.getByRole('button', { name: 'Đặt người trên bản đồ' }).click();
  await page.mouse.click(806, 662);
  await page.waitForTimeout(1200);
  // Open the panel again if it is still shut.
  if (
    (await page.locator('.panel-handle').getAttribute('aria-expanded')) ===
    'false'
  ) {
    await page.click('.panel-handle');
    await page.waitForTimeout(900);
  }
  await toggleAuto(page);
  await page.locator('.next-stop').waitFor({ timeout: 10000 });
  check('D: the walker gets the welcome box too', true);
  await page.locator('.next-stop .close-button').click();
  await page.locator('.search-box input').fill('Nam Tú');
  await page.waitForTimeout(800);
  await page
    .locator('.poi-card')
    .first()
    .evaluate((el) => el.click());
  await page.waitForTimeout(1200);
  await page
    .getByRole('button', { name: 'Dẫn đường từ người mô phỏng' })
    .evaluate((el) => el.click());
  await page.waitForFunction(
    () => window.__said.some((t) => /^Bạn đang đến /.test(t)),
    null,
    { timeout: 40000 },
  );
  const arrivals = (await s.said()).filter((t) => /^Bạn đang đến /.test(t));
  check(
    'D: a zone is introduced while the walker walks',
    arrivals.length >= 1,
    arrivals[0]?.slice(0, 40),
  );
  check(
    'D: its card is shown',
    (await page.locator('.zone-card').count()) === 1,
  );
  s.stop();
  await s.context.close();
}

// ---- G: the refresh button forces the narration of where the visitor stands
{
  // In a zone: its introduction is spoken now, even though nothing new happened.
  const s = await session(inThrill);
  await toggleAuto(s.page);
  await s.page.locator('.next-stop').waitFor({ timeout: 12000 });
  await s.page.locator('.next-stop .close-button').click();
  await s.page.waitForTimeout(1500);
  const arrivals = async () =>
    (await s.said()).filter((t) => /^Bạn đang đến /.test(t)).length;
  const before = await arrivals();
  await s.page.getByRole('button', { name: /Làm mới thuyết minh/ }).click();
  await s.page.waitForFunction(
    (n) => window.__said.filter((t) => /^Bạn đang đến /.test(t)).length > n,
    before,
    { timeout: 8000 },
  );
  check('G: refresh speaks the zone you stand in', true);
  check(
    'G: its card is shown',
    (await s.page.locator('.zone-card').count()) === 1,
  );
  s.stop();
  await s.context.close();
}
{
  // Outside every zone: the nearest place is spoken, even with the auto switch off.
  const s = await session(
    at(where('svc-parking-1'), 0.0001),
    undefined,
    { width: 1400, height: 900 },
    { noZones: true },
  );
  await s.page.waitForTimeout(500);
  await s.page.getByRole('button', { name: /Làm mới thuyết minh/ }).click();
  await s.page.waitForTimeout(1500);
  // no position is known while auto narration is off and nothing is placed
  check(
    'G: without a position the refresh says so',
    /Chưa có vị trí của bạn/.test(await s.page.locator('body').innerText()),
  );
  await toggleAuto(s.page);
  await s.page.waitForTimeout(4000);
  await s.page.getByRole('button', { name: /Làm mới thuyết minh/ }).click();
  await s.page.waitForFunction(
    () => window.__said.some((t) => /^Bãi đậu xe số một/.test(t)),
    null,
    { timeout: 10000 },
  );
  check('G: refresh speaks the nearest place', true);
  s.stop();
  await s.context.close();
}
{
  // Far from everything: nothing to narrate, and it says so.
  const s = await session(farAway);
  await toggleAuto(s.page);
  await s.page.waitForTimeout(3000);
  const spoken = (await s.said()).length;
  await s.page.getByRole('button', { name: /Làm mới thuyết minh/ }).click();
  await s.page.waitForTimeout(1500);
  check(
    'G: nothing near: nothing is spoken',
    (await s.said()).length === spoken,
  );
  s.stop();
  await s.context.close();
}

// ---- F: walking past single places: they narrate, with a Stop button; Stop stops, the next plays
{
  // The click below is placed for this window size (whole-park view).
  const s = await session(
    farAway,
    undefined,
    { width: 1440, height: 860 },
    { noZones: true },
  );
  const page = s.page;
  await page.click('.panel-handle');
  await page.waitForTimeout(900);
  await page
    .getByRole('button', { name: /Mở bảng mô phỏng/ })
    .click()
    .catch(() => {});
  await page.getByRole('button', { name: 'Đặt người trên bản đồ' }).click();
  await page.mouse.click(806, 662);
  await page.waitForTimeout(1200);
  // Open the panel again if it is still shut.
  if (
    (await page.locator('.panel-handle').getAttribute('aria-expanded')) ===
    'false'
  ) {
    await page.click('.panel-handle');
    await page.waitForTimeout(900);
  }
  await toggleAuto(page);
  // Without zones there is no welcome box: only the places speak.
  await page.waitForTimeout(1500);
  await page.evaluate(() => (window.__speechMs = 9000));
  await page.locator('.search-box input').fill('Nam Tú');
  await page.waitForTimeout(800);
  await page
    .locator('.poi-card')
    .first()
    .evaluate((el) => el.click());
  await page.waitForTimeout(1200);
  await page
    .getByRole('button', { name: 'Dẫn đường từ người mô phỏng' })
    .evaluate((el) => el.click());
  const isPlace = (t) => !/^(Bạn đang (đến|ở)|You )/.test(t);
  // a single place narrates by itself while the walker is walking (not only at the end)
  await page.waitForFunction(
    () => window.__said.some((t) => !/^(Bạn đang (đến|ở)|You )/.test(t)),
    null,
    { timeout: 60000 },
  );
  check('F: a place narrates by itself as the walker walks by', true);
  // …and a Stop button is on screen for it
  await page
    .locator('.now-playing, .zone-card .zone-stop')
    .first()
    .waitFor({ timeout: 20000 });
  const spokenBefore = (await s.said()).length;
  const stopButton = page
    .locator('.now-playing .zone-stop, .zone-card .zone-stop')
    .first();
  await stopButton.waitFor({ timeout: 20000 });
  check('F: Stop button while it plays', true);
  await stopButton.click();
  await page.waitForTimeout(600);
  check(
    'F: Stop stops it',
    (await page.locator('.now-playing').count()) === 0 &&
      (await page.locator('.zone-speaking').count()) === 0,
  );
  // walking on, the next place (or zone) plays
  await page.waitForFunction((n) => window.__said.length > n, spokenBefore, {
    timeout: 60000,
  });
  check('F: walking on, the next one plays', true);
  const places = (await s.said()).filter(isPlace);
  check(
    'F: it was a place, not a zone',
    places.length >= 1,
    places[0]?.slice(0, 40),
  );
  s.stop();
  await s.context.close();
}

await browser.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
