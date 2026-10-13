/* global console */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import {
  lastAggregateJson,
  sanitizeDashboardAggregate,
  sanitizeRealtimeAggregate,
  stagingChildEnvironments,
  validateStagingGateInputs,
} from './lib/operations-staging-gate.mjs';

const startedAt = new Date();
const defaultReport = resolve(
  'deliverables',
  `operations-staging-gate-${startedAt.toISOString().replaceAll(':', '-')}.json`,
);
const reportPath = resolve(
  process.env.OPERATIONS_STAGING_REPORT?.trim() || defaultReport,
);

function runScript(script, env, label, sanitize) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.resume();
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${label} failed with exit ${code}`));
        return;
      }
      resolvePromise(sanitize(lastAggregateJson(stdout, label)));
    });
  });
}

const report = {
  schemaVersion: 1,
  environment: process.env.OPERATIONS_STAGING_ENVIRONMENT?.trim(),
  deploymentSha: process.env.OPERATIONS_STAGING_DEPLOYMENT_SHA?.trim(),
  startedAt: startedAt.toISOString(),
  completedAt: undefined,
  status: 'failed',
  dashboard: undefined,
  realtime: undefined,
  failure: undefined,
};

try {
  const inputs = validateStagingGateInputs(process.env);
  const childEnvironments = stagingChildEnvironments(inputs);
  report.environment = inputs.environmentName;
  report.deploymentSha = inputs.deploymentSha;
  report.dashboard = await runScript(
    'scripts/benchmark-operations-dashboard.mjs',
    childEnvironments.dashboard,
    'dashboard benchmark',
    sanitizeDashboardAggregate,
  );
  report.realtime = await runScript(
    'scripts/load-operations-realtime.mjs',
    childEnvironments.realtime,
    'realtime load gate',
    sanitizeRealtimeAggregate,
  );
  report.status = 'passed';
} catch (error) {
  report.failure = error instanceof Error ? error.message : 'Unknown failure';
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      status: report.status,
      reportPath,
      environment: report.environment,
      deploymentSha: report.deploymentSha,
    }),
  );
}
