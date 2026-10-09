/* global process, console, document, sessionStorage, fetch, Buffer */
// Browser smoke for T25C/T02 + AI04/T04 + I01/I03 (locale tabs and AI generation UX).
// Not part of `npm test`: it needs the admin app built/started, the API with a
// dev admin account, and a local Chromium + playwright-core.
//
//   SMOKE_MODE=demo|api ADMIN_EMAIL=... ADMIN_PASSWORD=... \
//   PLAYWRIGHT_CORE_PATH=... CHROMIUM_PATH=... \
//   node apps/admin-web/scripts/narration-browser-smoke.mjs http://localhost:3001 http://localhost:3000
//
// SMOKE_MODE=demo (default): app built with NEXT_PUBLIC_NARRATION_DATA_MODE=demo
// and NEXT_PUBLIC_TTS_GENERATION_MODE=demo (fixture catalog VI/EN/FR, simulated
// jobs). SMOKE_MODE=api: app built with both flags `api`; tabs must match the
// real `GET /v1/narration-locales`, and jobs go through the real AI04 endpoints,
// so a TTS worker must be consuming `tts_generation_jobs` (see
// docs/runbooks/frontend-i01-integration-report.md). In api mode the job may sit
// in `queued` for a few seconds before a worker claims it; cancel is exercised
// in that window. SMOKE_FAIL_MARKER (api mode, optional): text the worker's
// provider is known to reject, to exercise the failed → retry path.
// Api mode also checks contract v1.1 (ADR 0014): the succeeded audio is
// attached to the draft with `audioGeneratedBy`, plays through the admin
// playback URL (bytes hashed against the draft's sha256, so object storage must
// be reachable from this process), and a page reload resumes an in-flight job
// through `GET …/tts-jobs/latest`.
//
// It creates one draft narration revision (marked "[smoke]") and deletes it at
// the end. Credentials come from the environment and are never printed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3001';
const apiBase = process.argv[3] ?? 'http://localhost:3000';
const mode = process.env.SMOKE_MODE === 'api' ? 'api' : 'demo';
const failMarker = process.env.SMOKE_FAIL_MARKER ?? '';
const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD.');
  process.exit(2);
}
const corePath = process.env.PLAYWRIGHT_CORE_PATH ?? 'playwright-core';
let chromium;
try {
  ({ chromium } = await import(
    corePath.startsWith('/')
      ? pathToFileURL(path.join(corePath, 'index.mjs')).href
      : corePath
  ));
} catch {
  console.error(
    'playwright-core is not installed. Install it outside the repo and set PLAYWRIGHT_CORE_PATH.',
  );
  process.exit(2);
}

// Real jobs wait for a worker claim + synthesis; fixture jobs take ~4 s.
const jobTimeout = mode === 'api' ? 60_000 : 15_000;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(10_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const status = page.locator('.tts-status');
const waitForStatus = (pattern) =>
  page.waitForFunction(
    (source) =>
      new RegExp(source).test(
        document.querySelector('.tts-status')?.textContent ?? '',
      ),
    pattern.source,
    { timeout: jobTimeout },
  );
// The draft's AI audio preview: labelled, with provenance, and the signed
// playback URL serves exactly the bytes recorded on the draft.
const expectDraftAiAudio = async (draft) => {
  const preview = page.locator('.draft-audio.ai-preview');
  await preview.locator('audio').waitFor({ timeout: jobTimeout });
  const text = await preview.innerText();
  assert.match(text, /AI-generated/);
  assert.ok(text.includes(draft.audioGeneratedBy.voiceId), 'voice shown');
  assert.ok(text.includes(draft.audioGeneratedBy.license), 'license shown');
  const src = await preview.locator('audio').getAttribute('src');
  const bytes = Buffer.from(await (await fetch(src)).arrayBuffer());
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    draft.audio.sha256,
    'playback bytes match the draft audio',
  );
};
const sessionToken = () =>
  page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem('damsen.admin.session.v1') ?? '{}')
        .accessToken ?? '',
  );
const smokeDraft = async () => {
  const poiId = page.url().split('/pois/')[1] ?? '';
  const list = await fetch(`${apiBase}/v1/admin/pois/${poiId}/narrations`, {
    headers: { authorization: `Bearer ${await sessionToken()}` },
  }).then((response) => response.json());
  return list.find((item) => item.transcript.startsWith('[smoke]'));
};
// Observed job ids/statuses only (no transcript) as E2E evidence.
const jobLog = [];
page.on('response', async (response) => {
  if (!/\/v1\/admin\/(narrations\/[^/]+\/)?tts-jobs/.test(response.url()))
    return;
  try {
    const body = await response.json();
    // v1.1 `…/tts-jobs/latest` wraps the job: { job: TtsGenerationJob | null }.
    const latest = response.url().endsWith('/latest');
    const job = (latest ? body.job : body) ?? {};
    const entry = `${response.request().method()}${latest ? '(latest)' : ''} ${response.status()} ${job.id?.slice(0, 8) ?? '-'} ${job.status ?? body.code ?? 'none'}`;
    if (jobLog.at(-1) !== entry) jobLog.push(entry);
  } catch {
    /* non-JSON response */
  }
});

try {
  await page.goto(`${base}/pois`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', ADMIN_EMAIL);
  await page.fill('input[type=password]', ADMIN_PASSWORD);
  await page.click('button:has-text("Đăng nhập")');
  await page
    .locator('a[href^="/pois/"]:not([href="/pois/new"])')
    .first()
    .click();
  const tabs = page.getByRole('tab');
  await tabs.first().waitFor();
  const labels = (await tabs.allInnerTexts()).map((label) => label.trim());
  // Demo: fixture VI/EN/FR. Api: exactly the configured, enabled catalog.
  const expected =
    mode === 'api'
      ? (
          await fetch(`${apiBase}/v1/narration-locales`).then((response) =>
            response.json(),
          )
        ).locales.map((option) => option.nativeLabel)
      : ['Tiếng Việt', 'English', 'Français'];
  assert.equal(labels.length, expected.length, `tabs: ${labels}`);
  expected.forEach((label, index) =>
    assert.ok(labels[index].startsWith(label), `tab ${index}: ${labels}`),
  );

  // Keyboard: Arrow/Home/End move selection and focus.
  await tabs.first().focus();
  await page.keyboard.press('End');
  assert.ok(
    (
      await page.locator('[role=tab][aria-selected=true]').innerText()
    ).startsWith(expected.at(-1)),
  );
  // Last tab: either no narration yet (FR) or a published one; neither can
  // generate before a draft is saved.
  assert.match(
    await page.locator('.tts-generation').innerText(),
    /Lưu bản nháp thuyết minh trước|Chỉ tạo audio AI cho bản nháp|đưa về nháp/,
  );
  await page.keyboard.press('Home');

  const editor = page.locator('.narration-editor textarea');
  const saveDraft = async (text) => {
    await editor.fill(text);
    await page.getByRole('button', { name: 'Lưu thuyết minh' }).click();
    await page.waitForFunction(
      () =>
        !document
          .querySelector('.tts-generation .button.primary')
          ?.hasAttribute('disabled'),
    );
  };
  const startNew = page.getByRole('button', { name: 'Tạo phiên bản mới' });
  if (await startNew.count()) await startNew.click();
  await editor.fill(
    '[smoke] Bản nháp kiểm thử luồng tạo audio AI, nội dung tổng hợp.',
  );
  assert.ok(
    await page.getByRole('button', { name: 'Tạo audio AI' }).isDisabled(),
    'generation must wait for a saved transcript',
  );
  await saveDraft(
    '[smoke] Bản nháp kiểm thử luồng tạo audio AI, nội dung tổng hợp.',
  );
  await page.getByRole('button', { name: 'Tạo audio AI' }).click();
  assert.equal(await status.getAttribute('aria-live'), 'polite');
  await waitForStatus(/Đang chờ|Đang tạo/);
  // A draft must not be saved or submitted while generation is in flight.
  const submit = page.getByRole('button', { name: 'Gửi duyệt' });
  const save = page.getByRole('button', { name: 'Lưu thuyết minh' });
  assert.ok(await submit.isDisabled(), 'submit blocked while job in flight');
  assert.ok(await save.isDisabled(), 'save blocked while job in flight');
  if (mode === 'api') await waitForStatus(/^Đang tạo audio/); // worker claimed it
  await waitForStatus(/^Đã tạo xong/);
  assert.ok(await submit.isEnabled(), 'submit allowed after success');
  const panel = page.locator('.tts-generation');
  assert.match(await panel.innerText(), /AI-generated/);
  assert.match(
    await page.locator('.tts-generation .tts-provenance').innerText(),
    /Phiên bản model/,
  );
  if (mode === 'api') {
    // v1.1: output stays a draft (never published) and carries the audio with
    // AI provenance; the editor plays it through the admin playback URL.
    const draft = await smokeDraft();
    assert.equal(draft.status, 'draft', 'AI output never publishes');
    assert.ok(draft.audio, 'succeeded job attached audio to the draft');
    assert.ok(draft.audioGeneratedBy?.jobId, 'audioGeneratedBy provenance');
    await expectDraftAiAudio(draft);
    assert.match(await panel.innerText(), /đã được gắn vào bản nháp/);
    // Reload: the latest job (terminal) and the draft audio come back.
    await page.reload({ waitUntil: 'networkidle' });
    await waitForStatus(/^Đã tạo xong/);
    await expectDraftAiAudio(draft);
    assert.match(
      await page.locator('.narration-history').innerText(),
      /Audio AI/,
      'revision history shows AI provenance',
    );
    // Same transcript + model version is idempotent server-side, so a new job
    // needs a changed, saved transcript.
    await saveDraft(
      '[smoke] Bản nháp kiểm thử luồng tạo audio AI, nội dung tổng hợp (lần 2).',
    );
  }

  await page.getByRole('button', { name: 'Tạo lại audio AI' }).click();
  await waitForStatus(/Đang chờ|Đang tạo/);
  if (mode === 'api') {
    // A full reload loses all page state; tracking resumes from the server.
    await page.reload({ waitUntil: 'networkidle' });
    await waitForStatus(/Đang chờ|Đang tạo/);
    assert.ok(
      await page.getByRole('button', { name: 'Gửi duyệt' }).isDisabled(),
      'submit still blocked after reload',
    );
  }
  // Switching locale tabs remounts the editor; the running job is resumed.
  await page.locator('[role=tab][aria-selected=true]').focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  await waitForStatus(/Đang chờ|Đang tạo/);
  assert.ok(
    await page.getByRole('button', { name: 'Gửi duyệt' }).isDisabled(),
    'submit still blocked after tab switch',
  );
  await page.getByRole('button', { name: 'Huỷ tạo audio' }).click();
  await waitForStatus(/^Đã huỷ/);
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await waitForStatus(/^Đã tạo xong/);

  if (mode === 'api' && failMarker) {
    await saveDraft(
      `[smoke] ${failMarker} Bản nháp kiểm thử nhánh lỗi của dịch vụ TTS.`,
    );
    await page.getByRole('button', { name: 'Tạo lại audio AI' }).click();
    await waitForStatus(/^Tạo audio thất bại — /);
    assert.ok(
      await page.getByRole('button', { name: 'Thử lại' }).isEnabled(),
      'retry offered after failure',
    );
    assert.ok(await submit.isEnabled(), 'failure does not block the draft');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390,
    'horizontal overflow at 390px',
  );
  assert.deepEqual(errors, []);
  if (mode === 'api') console.log(`jobs:\n  ${jobLog.join('\n  ')}`);
  console.log(`PASS admin narration + AI generation smoke (${mode})`);
} finally {
  const token = await sessionToken().catch(() => '');
  const poiId = page.url().split('/pois/')[1] ?? '';
  if (token && poiId) {
    const headers = { authorization: `Bearer ${token}` };
    const list = await fetch(`${apiBase}/v1/admin/pois/${poiId}/narrations`, {
      headers,
    }).then((response) => (response.ok ? response.json() : []));
    for (const item of list.filter(
      (narration) =>
        narration.status === 'draft' &&
        narration.transcript.startsWith('[smoke]'),
    ))
      await fetch(`${apiBase}/v1/admin/narrations/${item.id}`, {
        method: 'DELETE',
        headers,
      });
  }
  await browser.close();
}
