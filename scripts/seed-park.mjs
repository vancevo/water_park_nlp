/* global process */
// One command that puts the park places into a fresh database: the footpath graph, the
// places (published, with their entrances on the paths), their positions and their written content.
//
//   # API running (npm run dev:api) against the migrated database
//   ADMIN_PASSWORD=... node scripts/seed-park.mjs        # or: npm run seed:park
//
// Migrations alone only seed 5 synthetic fixture places, so a fresh clone shows a map
// without the 50 places until this runs. Safe to repeat: every step skips what exists.
//   env: API_URL (default http://localhost:3000), ADMIN_EMAIL (default admin@damsen.local),
//        ADMIN_PASSWORD (required), DATABASE_URL (default: the local docker database)
import { execFileSync } from 'node:child_process';
import { Console } from 'node:console';
import { fileURLToPath, URL } from 'node:url';

const logger = new Console({ stdout: process.stdout, stderr: process.stderr });
if (!process.env.ADMIN_PASSWORD) {
  logger.error(
    'ADMIN_PASSWORD is required (the admin of the API that is running).',
  );
  process.exit(1);
}
const dryRun = process.argv.includes('--dry-run');

function run(script, args = []) {
  logger.log(`\n> node scripts/${script} ${args.join(' ')}`.trimEnd());
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL(script, import.meta.url)), ...args],
    { stdio: 'inherit', env: process.env },
  );
}

const flags = dryRun ? ['--dry-run'] : [];
// 1. graph first: places snap their entrance to its nodes.
run('import-redrawn-walkways.mjs', flags);
// 2. create / submit / approve the places through the admin API (skips existing slugs).
run('import-pois.mjs', flags);
// 3. now that the places exist: exact entrance nodes and pin positions.
run('import-redrawn-walkways.mjs', flags);
// 4. the written content of the 77 places (descriptions + narration text), through the admin API.
run('import-poi-content.mjs', dryRun ? [] : ['--apply']);
logger.log('\nPark places seeded.');
