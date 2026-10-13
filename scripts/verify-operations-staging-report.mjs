/* global console */
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import {
  sanitizeDashboardAggregate,
  sanitizeRealtimeAggregate,
} from './lib/operations-staging-gate.mjs';

const requestedPath =
  process.argv[2]?.trim() || process.env.OPERATIONS_STAGING_REPORT?.trim();

function exactFields(value, expected, label) {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${label} contains missing or unexpected fields`);
  }
}

function strictTimestamp(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be ISO time`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be canonical ISO time`);
  }
  return parsed;
}

async function verify() {
  if (!requestedPath) {
    throw new Error(
      'Pass a report path or set OPERATIONS_STAGING_REPORT for verification',
    );
  }
  const reportPath = resolve(requestedPath);
  const metadata = await lstat(reportPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Staging report must be a regular non-symlink file');
  }
  if (metadata.size < 2 || metadata.size > 64 * 1024) {
    throw new Error('Staging report size is outside the accepted range');
  }
  if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
    throw new Error('Staging report must not grant group/other permissions');
  }

  let report;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch {
    throw new Error('Staging report must contain valid JSON');
  }
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('Staging report must be a JSON object');
  }
  exactFields(
    report,
    [
      'schemaVersion',
      'environment',
      'deploymentSha',
      'startedAt',
      'completedAt',
      'status',
      'dashboard',
      'realtime',
    ],
    'report',
  );
  if (report.schemaVersion !== 1 || report.status !== 'passed') {
    throw new Error(
      'Staging report schema/status is not a passing v1 artifact',
    );
  }
  if (
    typeof report.environment !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(report.environment)
  ) {
    throw new Error('Staging report environment is invalid');
  }
  if (
    typeof report.deploymentSha !== 'string' ||
    !/^[a-f0-9]{7,64}$/i.test(report.deploymentSha)
  ) {
    throw new Error('Staging report deployment SHA is invalid');
  }
  const startedAt = strictTimestamp(report.startedAt, 'startedAt');
  const completedAt = strictTimestamp(report.completedAt, 'completedAt');
  if (completedAt.getTime() < startedAt.getTime()) {
    throw new Error('Staging report completion precedes its start');
  }

  const dashboard = sanitizeDashboardAggregate(report.dashboard);
  const realtime = sanitizeRealtimeAggregate(report.realtime);
  exactFields(report.dashboard, Object.keys(dashboard), 'dashboard');
  exactFields(report.realtime, Object.keys(realtime), 'realtime');

  console.log(
    JSON.stringify({
      status: 'verified',
      environment: report.environment,
      deploymentSha: report.deploymentSha,
      startedAt: report.startedAt,
      completedAt: report.completedAt,
      dashboardP95Ms: dashboard.p95Ms,
      presenceDeltaP95Ms: realtime.presenceDeltaP95Ms,
    }),
  );
}

try {
  await verify();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Verification failed');
  process.exitCode = 1;
}
