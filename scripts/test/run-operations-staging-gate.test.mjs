import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';

import {
  STAGING_GATE_CONFIRMATION,
  STAGING_GATE_PROFILE,
  lastAggregateJson,
  sanitizeDashboardAggregate,
  sanitizeRealtimeAggregate,
  stagingChildEnvironments,
  validateStagingGateInputs,
} from '../lib/operations-staging-gate.mjs';

const validEnvironment = {
  OPERATIONS_STAGING_GATE_CONFIRM: STAGING_GATE_CONFIRMATION,
  OPERATIONS_STAGING_API_URL: 'https://staging.example.invalid/api/?secret=x',
  OPERATIONS_STAGING_ENVIRONMENT: 'demo-staging',
  OPERATIONS_STAGING_DEPLOYMENT_SHA: 'abcdef1234567',
  OPERATIONS_STAGING_ADMIN_EMAIL: 'synthetic@example.invalid',
  OPERATIONS_STAGING_ADMIN_PASSWORD: 'not-a-real-secret',
};

test('validates staging identity and strips query/fragment data', () => {
  const inputs = validateStagingGateInputs(validEnvironment);
  assert.equal(inputs.apiUrl, 'https://staging.example.invalid/api');
  assert.equal(inputs.environmentName, 'demo-staging');
  assert.equal(inputs.deploymentSha, 'abcdef1234567');
});

test('rejects missing confirmation, local targets and invalid deployment SHA', () => {
  assert.throws(
    () =>
      validateStagingGateInputs({
        ...validEnvironment,
        OPERATIONS_STAGING_GATE_CONFIRM: '',
      }),
    /Set OPERATIONS_STAGING_GATE_CONFIRM/,
  );
  assert.throws(
    () =>
      validateStagingGateInputs({
        ...validEnvironment,
        OPERATIONS_STAGING_API_URL: 'http://127.0.0.1:3000',
      }),
    /HTTPS.*loopback\/local/,
  );
  assert.throws(
    () =>
      validateStagingGateInputs({
        ...validEnvironment,
        OPERATIONS_STAGING_DEPLOYMENT_SHA: 'not-a-sha',
      }),
    /7\.\.64 hex SHA/,
  );
});

test('locks the staging capacity profile and child environments', () => {
  assert.deepEqual(STAGING_GATE_PROFILE, {
    dashboardSamples: '100',
    dashboardWarmup: '10',
    dashboardP95ThresholdMs: '1000',
    visitorClients: '1000',
    publishers: '500',
    updatesPerSecond: '100',
    adminClients: '10',
    eventSettleMs: '2000',
    presenceDeltaP95ThresholdMs: '2000',
  });
  const inputs = validateStagingGateInputs(validEnvironment);
  const childEnvironments = stagingChildEnvironments(inputs);
  assert.equal(childEnvironments.dashboard.OPERATIONS_BENCHMARK_SAMPLES, '100');
  assert.equal(childEnvironments.realtime.OPERATIONS_LOAD_CLIENTS, '1000');
  assert.equal(childEnvironments.realtime.OPERATIONS_LOAD_ADMIN_CLIENTS, '10');
  assert.equal(
    childEnvironments.realtime.OPERATIONS_LOAD_PRESENCE_DELTA_P95_THRESHOLD_MS,
    '2000',
  );
});

test('parses only the last aggregate JSON line', () => {
  assert.deepEqual(lastAggregateJson('setup\n{"p95Ms":42}\n', 'test'), {
    p95Ms: 42,
  });
  assert.throws(() => lastAggregateJson('not-json', 'test'), /aggregate JSON/);
});

test('allowlists passing aggregates and rejects profile drift', () => {
  const dashboard = sanitizeDashboardAggregate({
    samples: 100,
    warmup: 10,
    p50Ms: 100,
    p95Ms: 400,
    maxMs: 500,
    thresholdMs: 1000,
    accessToken: 'must-not-survive',
  });
  assert.equal('accessToken' in dashboard, false);

  const realtimeInput = {
    requestedSockets: 1000,
    connectedSockets: 1000,
    successfulUpdates: 500,
    failures: 0,
    failureCodes: {},
    connectP95Ms: 40,
    requestedAdminMaps: 10,
    connectedAdminMaps: 10,
    adminConnectP95Ms: 30,
    adminMapsReceivingPresence: 10,
    adminPresenceEvents: 5000,
    presenceDeltaSamples: 5000,
    presenceDeltaP95Ms: 80,
    presenceDeltaP95ThresholdMs: 2000,
    updateP95Ms: 60,
    updateBatchMs: 5000,
    latitude: 10.75,
  };
  const realtime = sanitizeRealtimeAggregate(realtimeInput);
  assert.equal('latitude' in realtime, false);
  assert.throws(
    () =>
      sanitizeRealtimeAggregate({
        ...realtimeInput,
        connectedAdminMaps: 9,
      }),
    /does not satisfy/,
  );
  assert.throws(
    () => sanitizeDashboardAggregate({ ...dashboard, p95Ms: 1000 }),
    /does not satisfy/,
  );
});

test('writes a private failure artifact without target or credentials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'operations-staging-gate-'));
  const reportPath = join(directory, 'report.json');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/run-operations-staging-gate.mjs'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...validEnvironment,
          OPERATIONS_STAGING_API_URL: 'http://127.0.0.1:3000',
          OPERATIONS_STAGING_REPORT: reportPath,
        },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 1);
    assert.equal(statSync(reportPath).mode & 0o777, 0o600);
    const artifact = readFileSync(reportPath, 'utf8');
    assert.doesNotMatch(artifact, /127\.0\.0\.1/);
    assert.doesNotMatch(artifact, /synthetic@example\.invalid/);
    assert.doesNotMatch(artifact, /not-a-real-secret/);
    assert.equal(JSON.parse(artifact).status, 'failed');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function passingReport() {
  return {
    schemaVersion: 1,
    environment: 'demo-staging',
    deploymentSha: 'abcdef1234567',
    startedAt: '2026-10-13T00:00:00.000Z',
    completedAt: '2026-10-13T00:05:00.000Z',
    status: 'passed',
    dashboard: {
      samples: 100,
      warmup: 10,
      p50Ms: 100,
      p95Ms: 400,
      maxMs: 500,
      thresholdMs: 1000,
    },
    realtime: {
      requestedSockets: 1000,
      connectedSockets: 1000,
      successfulUpdates: 500,
      failures: 0,
      failureCodes: {},
      connectP95Ms: 40,
      requestedAdminMaps: 10,
      connectedAdminMaps: 10,
      adminConnectP95Ms: 30,
      adminMapsReceivingPresence: 10,
      adminPresenceEvents: 5000,
      presenceDeltaSamples: 5000,
      presenceDeltaP95Ms: 80,
      presenceDeltaP95ThresholdMs: 2000,
      updateP95Ms: 60,
      updateBatchMs: 5000,
    },
  };
}

test('verifies a private passing artifact and rejects injected fields', () => {
  const directory = mkdtempSync(join(tmpdir(), 'operations-staging-verify-'));
  const reportPath = join(directory, 'report.json');
  const runVerifier = () =>
    spawnSync(
      process.execPath,
      ['scripts/verify-operations-staging-report.mjs', reportPath],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
  try {
    writeFileSync(reportPath, `${JSON.stringify(passingReport())}\n`, {
      mode: 0o600,
    });
    const passing = runVerifier();
    assert.equal(passing.status, 0);
    assert.equal(JSON.parse(passing.stdout).status, 'verified');

    const injected = passingReport();
    injected.realtime.accessToken = 'must-not-survive';
    writeFileSync(reportPath, `${JSON.stringify(injected)}\n`);
    assert.equal(runVerifier().status, 1);

    if (process.platform !== 'win32') {
      writeFileSync(reportPath, `${JSON.stringify(passingReport())}\n`);
      chmodSync(reportPath, 0o644);
      assert.equal(runVerifier().status, 1);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
