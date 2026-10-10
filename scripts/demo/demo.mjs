/* global console, fetch, setTimeout */
// One-command local demo of Dam Sen Smart Guide (Windows / macOS / Linux).
//
//   node scripts/demo/demo.mjs setup    first time: installs and downloads everything
//   node scripts/demo/demo.mjs start    starts the whole demo and opens the browser
//   node scripts/demo/demo.mjs stop     stops everything (also Ctrl+C in the start window)
//   node scripts/demo/demo.mjs status   shows what is running
//
// On Windows the files in demo/ (double-click) call these commands.
// Needs: Node.js 24, Docker Desktop (running), Python 3.9+ and internet for
// the first setup. Everything generated lives in .demo/ (gitignored).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import pg from 'pg';

import {
  calibrateSimilarityFloor,
  evaluateSearch,
} from './calibrate-search.mjs';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DemoError,
  PORTS,
  demoDir,
  docker,
  dockerAvailable,
  ensureDemoEnv,
  findPython,
  httpOk,
  node,
  npm,
  ok,
  openBrowser,
  portInUse,
  readDemoEnv,
  repoRoot,
  run,
  say,
  serviceEnv,
  startService,
  step,
  venvPiper,
  venvPython,
  waitFor,
  warn,
  writeDemoEnv,
} from './lib.mjs';
import { seedNarrations } from './seed-narrations.mjs';

const external = process.env.DEMO_EXTERNAL_SERVICES === '1';
const URLS = {
  visitor: `http://localhost:${PORTS.visitor}`,
  admin: `http://localhost:${PORTS.admin}`,
  api: `http://127.0.0.1:${PORTS.api}`,
  embedding: `http://127.0.0.1:${PORTS.embedding}`,
};
const pidFile = join(demoDir, 'pids.json');
const setupMarker = join(demoDir, 'setup-done.json');

// ---------------------------------------------------------------- checks ---

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 24)
    throw new DemoError(
      `Cần Node.js 24 (máy đang có ${process.versions.node}). Tải bản 24 LTS tại https://nodejs.org rồi chạy lại.`,
    );
  ok(`Node.js ${process.versions.node}`);
}

function checkDocker() {
  if (external) return ok('dùng Postgres/S3 có sẵn (DEMO_EXTERNAL_SERVICES=1)');
  if (!dockerAvailable())
    throw new DemoError(
      'Docker chưa chạy. Mở Docker Desktop, đợi biểu tượng cá voi báo "Engine running", rồi chạy lại.\n' +
        'Chưa cài thì tải tại https://www.docker.com/products/docker-desktop/',
    );
  ok('Docker Desktop đang chạy');
}

function checkPython() {
  const python = findPython();
  if (!python)
    throw new DemoError(
      'Cần Python 3.9+ để chạy giọng đọc Piper. Tải tại https://www.python.org/downloads/ ' +
        '(khi cài nhớ tick "Add python.exe to PATH"), rồi chạy lại.',
    );
  ok(`Python ${python.version}`);
  return python;
}

// ------------------------------------------------------------- services ---

async function startInfra() {
  if (external) return;
  await docker(['up', '-d', 'postgres', 'object-storage', 'redis']);
}

async function waitInfra(env) {
  await waitFor(
    'PostgreSQL',
    async () => {
      const client = new pg.Client({ connectionString: env.DATABASE_URL });
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return true;
    },
    { timeoutMs: 240_000 },
  );
  ok('PostgreSQL sẵn sàng');
  if (!external) {
    await waitFor(
      'MinIO',
      () => httpOk(`${env.S3_ENDPOINT}/minio/health/live`),
      {
        timeoutMs: 180_000,
      },
    );
    ok('MinIO (lưu audio) sẵn sàng');
  }
}

async function migrate(env) {
  await node(['scripts/migrate.mjs'], { env, quiet: true, label: 'migrate' });
  ok('database đã cập nhật (migrations)');
}

// ---------------------------------------------------------------- voices ---

async function download(url, target) {
  const res = await fetch(url);
  if (!res.ok || !res.body)
    throw new DemoError(`tải ${url} lỗi (${res.status})`);
  await mkdir(dirname(target), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
}

const sha256File = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');

async function ensureVoices() {
  if (process.env.DEMO_VOICES_MANIFEST)
    return ok('dùng manifest giọng thử nghiệm');
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'config/tts-voices.json'), 'utf8'),
  );
  for (const voice of manifest.voices.filter((v) => v.enabled)) {
    const onnx = join(repoRoot, voice.modelPath);
    if (!existsSync(onnx) || (await sha256File(onnx)) !== voice.checksum) {
      say(`   … đang tải giọng ${voice.voiceId} (~60 MB)`);
      await download(voice.sourceUrl, onnx);
      if ((await sha256File(onnx)) !== voice.checksum) {
        await rm(onnx, { force: true });
        throw new DemoError(
          `giọng ${voice.voiceId} tải về sai checksum — thử lại`,
        );
      }
    }
    if (!existsSync(`${onnx}.json`))
      await download(`${voice.sourceUrl}.json`, `${onnx}.json`);
    ok(`giọng ${voice.locale}: ${voice.voiceId} (checksum đúng)`);
  }
}

async function ensurePiper(python) {
  if (!existsSync(venvPython())) {
    await run(
      python.command,
      [...python.prefix, '-m', 'venv', join(demoDir, 'venv')],
      {
        label: 'python venv',
        quiet: true,
      },
    );
  }
  if (!existsSync(venvPiper())) {
    say('   … đang cài Piper (piper-tts)');
    await run(
      venvPython(),
      [
        '-m',
        'pip',
        'install',
        '--disable-pip-version-check',
        '-q',
        'piper-tts==1.8.0',
      ],
      {
        label: 'pip install piper-tts',
        quiet: true,
      },
    );
  }
  ok('Piper đã cài');
}

async function smokePiper() {
  if (process.env.DEMO_VOICES_MANIFEST) return;
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'config/tts-voices.json'), 'utf8'),
  );
  const vi = manifest.voices.find((v) => v.locale === 'vi' && v.enabled);
  const out = join(demoDir, 'piper-check.wav');
  await new Promise((resolve, reject) => {
    const child = spawn(
      venvPiper(),
      ['--model', join(repoRoot, vi.modelPath), '--output_file', out],
      {
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true,
      },
    );
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new DemoError(`Piper lỗi (${code}): ${err.slice(-500)}`)),
    );
    child.stdin.end('Xin chào, chào mừng bạn đến Đầm Sen.', 'utf8');
  });
  ok('Piper đọc thử tiếng Việt thành công');
}

// ------------------------------------------------------------ embeddings ---

function embeddingEnv() {
  return {
    EMBEDDING_PORT: String(PORTS.embedding),
    EMBEDDING_CACHE_DIR: join(demoDir, 'models'),
    ...(process.env.DEMO_EMBEDDING_LOCAL_MODEL_PATH
      ? {
          EMBEDDING_LOCAL_MODEL_PATH:
            process.env.DEMO_EMBEDDING_LOCAL_MODEL_PATH,
          EMBEDDING_MODEL_ID: process.env.DEMO_EMBEDDING_MODEL_ID,
        }
      : {}),
  };
}

async function ensureEmbeddingRuntime() {
  const runtime = join(repoRoot, 'tools/embedding-runtime');
  if (!existsSync(join(runtime, 'node_modules/@huggingface/transformers'))) {
    say('   … đang cài bộ chạy embedding (transformers.js, ~200 MB)');
    await npm(['ci', '--no-audit', '--no-fund'], {
      cwd: runtime,
      env: { ONNXRUNTIME_NODE_INSTALL: 'skip' },
      quiet: true,
    });
  }
  ok('bộ chạy embedding đã cài');
  say(
    '   … đang tải model bge-m3 (~570 MB, chỉ lần đầu) — có thể mất vài phút',
  );
  await node(['tools/embedding-runtime/server.mjs', '--warmup'], {
    env: { ...embeddingEnv(), EMBEDDING_PORT: '0' },
    label: 'embedding warmup',
  });
  ok('model embedding bge-m3 sẵn sàng');
}

// ------------------------------------------------------------------ setup ---

async function setup() {
  const total = 9;
  say('=== CÀI ĐẶT DEMO (chỉ cần chạy một lần) ===');
  step(1, total, 'Kiểm tra máy');
  checkNode();
  checkDocker();
  const python = checkPython();
  const demoEnv = await ensureDemoEnv();
  const env = serviceEnv(demoEnv);

  step(2, total, 'Cài thư viện Node (npm ci) — vài phút');
  await npm(['ci', '--no-audit', '--no-fund'], {
    env: { ONNXRUNTIME_NODE_INSTALL: 'skip' },
  });
  ok('thư viện đã cài');

  step(
    3,
    total,
    'Khởi động PostgreSQL + MinIO bằng Docker (lần đầu phải build, ~5 phút)',
  );
  if (!external)
    await docker([
      'up',
      '-d',
      '--build',
      'postgres',
      'object-storage',
      'redis',
    ]);
  await waitInfra(env);
  await migrate(env);

  step(4, total, 'Cài Piper (giọng đọc AI miễn phí, chạy trên CPU)');
  await ensurePiper(python);

  step(5, total, 'Tải giọng đọc Piper vi/en/fr');
  await ensureVoices();
  await smokePiper();

  step(6, total, 'Build ứng dụng (API, worker, admin, visitor) — vài phút');
  await npm(['run', 'build'], {
    env: {
      NEXT_PUBLIC_TTS_GENERATION_MODE: 'api',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  });
  ok('build xong');

  step(7, total, 'Cài embedding miễn phí (bge-m3)');
  await ensureEmbeddingRuntime();

  step(8, total, 'Hiệu chỉnh tìm kiếm ngữ nghĩa trên model vừa cài');
  const embedding = await startService(
    'embedding-setup',
    process.execPath,
    ['tools/embedding-runtime/server.mjs'],
    {
      env: embeddingEnv(),
    },
  );
  try {
    await waitFor('embedding', () => httpOk(`${URLS.embedding}/healthz`), {
      timeoutMs: 300_000,
    });
    await node(['apps/worker/dist/embedding/index-main.js'], {
      env: { ...env, EMBEDDING_URL: URLS.embedding },
      label: 'embeddings:index',
    });
    const result = await calibrateSimilarityFloor({
      databaseUrl: env.DATABASE_URL,
      embeddingUrl: env.SEARCH_EMBEDDING_URL,
      model: env.SEARCH_EMBEDDING_MODEL,
      modelVersion: env.SEARCH_EMBEDDING_MODEL_VERSION,
    });
    await writeDemoEnv({
      ...readDemoEnv(),
      SEARCH_HYBRID_MIN_SIMILARITY: String(result.floor),
      SEARCH_HYBRID_EXPAND: String(result.expand),
    });
    await writeFile(
      join(demoDir, 'search-calibration.json'),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    if (result.expand)
      ok(
        `ngưỡng tương đồng = ${result.floor} (câu vô nghĩa cao nhất ${result.noise}); ` +
          `bắt thêm được ${result.semanticReachable}/${result.semanticTotal} câu hỏi theo ý nghĩa`,
      );
    else
      warn(
        `model không tách được câu vô nghĩa (độ tương đồng ${result.noise}) — chỉ dùng vector để sắp xếp lại, không thêm kết quả`,
      );
  } finally {
    embedding.kill();
  }

  step(9, total, 'Hoàn tất');
  await writeFile(
    setupMarker,
    `${JSON.stringify({ at: new Date().toISOString() })}\n`,
  );
  ok('Cài đặt xong. Bây giờ chạy demo (2-CHAY-DEMO).');
}

// ------------------------------------------------------------------ start ---

async function start() {
  if (!existsSync(setupMarker))
    throw new DemoError('Chưa cài đặt. Chạy "1-CAI-DAT-LAN-DAU" trước.');
  say('=== CHẠY DEMO ===');
  checkDocker();
  for (const [name, port] of Object.entries({
    API: PORTS.api,
    admin: PORTS.admin,
    visitor: PORTS.visitor,
    embedding: PORTS.embedding,
  })) {
    if (await portInUse(port))
      throw new DemoError(
        `Cổng ${port} (${name}) đang bị chiếm — có thể demo cũ còn chạy. Chạy "3-DUNG-DEMO" rồi thử lại.`,
      );
  }
  const env = serviceEnv();
  const children = [];
  let stopping = false;
  const stopAll = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    say('\nĐang dừng demo…');
    for (const child of children) child.kill();
    if (!external)
      await docker(['stop'], { quiet: true }).catch(() => undefined);
    await rm(pidFile, { force: true });
    say('Đã dừng.');
    process.exit(code);
  };
  process.on('SIGINT', () => void stopAll());
  process.on('SIGTERM', () => void stopAll());
  process.on('SIGHUP', () => void stopAll());

  const launch = async (name, args, extraEnv = {}, cwd = repoRoot) => {
    const child = await startService(name, process.execPath, args, {
      cwd,
      env: { ...env, ...extraEnv },
      onExit: (code) => {
        if (!stopping)
          warn(`${name} đã tắt (mã ${code}). Xem .demo/logs/${name}.log`);
      },
    });
    children.push(child);
    await writeFile(pidFile, JSON.stringify(children.map((c) => c.pid)));
    return child;
  };

  step(1, 6, 'Khởi động PostgreSQL + MinIO');
  await startInfra();
  await waitInfra(env);
  await migrate(env);

  step(2, 6, 'Khởi động embedding (bge-m3) và cập nhật chỉ mục tìm kiếm');
  await launch(
    'embedding',
    ['tools/embedding-runtime/server.mjs'],
    embeddingEnv(),
  );
  await waitFor('embedding', () => httpOk(`${URLS.embedding}/healthz`), {
    timeoutMs: 300_000,
  });
  await node(['apps/worker/dist/embedding/index-main.js'], {
    env: { ...env, EMBEDDING_URL: URLS.embedding },
    quiet: true,
    label: 'embeddings:index',
  });
  ok('embedding sẵn sàng');

  step(3, 6, 'Khởi động API + worker giọng đọc AI');
  await launch('api', ['apps/api/dist/main.js'], { PORT: String(PORTS.api) });
  await waitFor('API', () => httpOk(`${URLS.api}/health`), {
    timeoutMs: 90_000,
  });
  const workerEnv = process.env.DEMO_VOICES_MANIFEST
    ? { TTS_WORKER_ENGINE: 'cli' }
    : { TTS_WORKER_ENGINE: 'piper', TTS_PIPER_BINARY: venvPiper() };
  await launch('worker', ['apps/worker/dist/worker.js'], {
    ...workerEnv,
    TTS_AUDIO_RELEASE_FORMAT: 'wav',
    WORKER_METRICS_PORT: String(PORTS.workerMetrics),
    // Piper (Python) must read the transcript as UTF-8 on Windows.
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  });
  await waitFor(
    'worker',
    () => httpOk(`http://127.0.0.1:${PORTS.workerMetrics}/healthz`),
    {
      timeoutMs: 60_000,
    },
  );
  ok('API và worker sẵn sàng');

  step(4, 6, 'Chuẩn bị nội dung demo (50 địa điểm + audio AI)');
  // Load the park's graph and its 50 numbered places into the migrated database.
  await node(['scripts/seed-park.mjs'], {
    env: {
      ...env,
      API_URL: URLS.api,
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
    },
    quiet: true,
    label: 'seed:park',
  });
  ok('đã nạp đồ thị đường đi và 50 địa điểm');
  // The places did not exist when the index was built in step 2.
  await node(['apps/worker/dist/embedding/index-main.js'], {
    env: { ...env, EMBEDDING_URL: URLS.embedding },
    quiet: true,
    label: 'embeddings:index',
  });
  const seeded = await seedNarrations({
    apiUrl: URLS.api,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    log: (line) => ok(line),
  });
  ok(`${seeded.created} bài thuyết minh mới, ${seeded.skipped} bài đã có sẵn`);

  step(5, 6, 'Khởi động web khách tham quan + web quản trị');
  const nextBin = join(repoRoot, 'node_modules/next/dist/bin/next');
  await launch(
    'visitor',
    [nextBin, 'start', '-p', String(PORTS.visitor)],
    {},
    join(repoRoot, 'apps/visitor-web'),
  );
  await launch(
    'admin',
    [nextBin, 'start', '-p', String(PORTS.admin)],
    {},
    join(repoRoot, 'apps/admin-web'),
  );
  await waitFor('web khách', () => httpOk(URLS.visitor), { timeoutMs: 90_000 });
  await waitFor('web quản trị', () => httpOk(URLS.admin), {
    timeoutMs: 90_000,
  });

  step(6, 6, 'Kiểm tra nhanh chất lượng tìm kiếm');
  try {
    const score = await evaluateSearch(URLS.api);
    ok(
      `Recall@10 = ${score.recallAt10}, MRR = ${score.mrr}, câu vô nghĩa trả rỗng đúng = ${score.expectedZeroAccuracy * 100}%`,
    );
  } catch (error) {
    warn(`bỏ qua đánh giá tìm kiếm (${error.message})`);
  }

  say('\n==================== DEMO ĐANG CHẠY ====================');
  say(`  Web khách tham quan : ${URLS.visitor}`);
  say(`  Web quản trị        : ${URLS.admin}`);
  say(`     đăng nhập        : ${ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}`);
  say('  Giữ cửa sổ này mở trong lúc demo. Nhấn Ctrl+C để dừng.');
  say('========================================================\n');
  if (process.env.DEMO_NO_BROWSER !== '1') {
    openBrowser(URLS.visitor);
    setTimeout(() => openBrowser(URLS.admin), 1500);
  }
  if (process.env.DEMO_EXIT_AFTER_START === '1') await stopAll(0);
}

// ------------------------------------------------------------- stop/status ---

async function stop() {
  if (existsSync(pidFile)) {
    for (const pid of JSON.parse(readFileSync(pidFile, 'utf8'))) {
      try {
        process.kill(pid);
      } catch {
        // already gone
      }
    }
    await rm(pidFile, { force: true });
  }
  if (!external && dockerAvailable())
    await docker(['stop'], { quiet: true }).catch(() => undefined);
  say('Đã dừng demo.');
}

async function status() {
  const checks = {
    'web khách (3002)': URLS.visitor,
    'web quản trị (3001)': URLS.admin,
    'API (3000)': `${URLS.api}/health`,
    'embedding (8091)': `${URLS.embedding}/healthz`,
    'worker (9464)': `http://127.0.0.1:${PORTS.workerMetrics}/healthz`,
  };
  for (const [name, url] of Object.entries(checks)) {
    const up = await httpOk(url).catch(() => false);
    say(`  ${up ? '✓' : '✗'} ${name}`);
  }
}

// ------------------------------------------------------------------- main ---

const commands = { setup, start, stop, status };
const command = commands[process.argv[2]];
if (!command) {
  say('Dùng: node scripts/demo/demo.mjs <setup|start|stop|status>');
  process.exit(2);
}
try {
  await mkdir(demoDir, { recursive: true });
  await command();
} catch (error) {
  console.error(
    `\n✗ ${error instanceof DemoError ? error.message : (error?.stack ?? error)}`,
  );
  console.error('  Nhật ký chi tiết nằm trong thư mục .demo/logs');
  process.exit(1);
}
