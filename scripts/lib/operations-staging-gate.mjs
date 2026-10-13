import { URL } from 'node:url';

export const STAGING_GATE_CONFIRMATION = 'run-demo-staging-gate';

export const STAGING_GATE_PROFILE = Object.freeze({
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

function validatedApiUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('OPERATIONS_STAGING_API_URL must be an absolute HTTPS URL');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.local')
  ) {
    throw new Error(
      'OPERATIONS_STAGING_API_URL must use HTTPS and must not target loopback/local',
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export function validateStagingGateInputs(env) {
  const confirmation = env.OPERATIONS_STAGING_GATE_CONFIRM;
  const apiUrl = env.OPERATIONS_STAGING_API_URL?.trim();
  const environmentName = env.OPERATIONS_STAGING_ENVIRONMENT?.trim();
  const deploymentSha = env.OPERATIONS_STAGING_DEPLOYMENT_SHA?.trim();
  const adminEmail = env.OPERATIONS_STAGING_ADMIN_EMAIL?.trim();
  const adminPassword = env.OPERATIONS_STAGING_ADMIN_PASSWORD;

  if (confirmation !== STAGING_GATE_CONFIRMATION) {
    throw new Error(
      `Set OPERATIONS_STAGING_GATE_CONFIRM=${STAGING_GATE_CONFIRMATION} to run the gate`,
    );
  }
  if (
    !apiUrl ||
    !environmentName ||
    !deploymentSha ||
    !adminEmail ||
    !adminPassword
  ) {
    throw new Error(
      'Staging API URL, environment, deployment SHA and synthetic admin credentials are required',
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(environmentName)) {
    throw new Error('OPERATIONS_STAGING_ENVIRONMENT has an invalid format');
  }
  if (!/^[a-f0-9]{7,64}$/i.test(deploymentSha)) {
    throw new Error(
      'OPERATIONS_STAGING_DEPLOYMENT_SHA must be a 7..64 hex SHA',
    );
  }
  return {
    apiUrl: validatedApiUrl(apiUrl),
    environmentName,
    deploymentSha,
    adminEmail,
    adminPassword,
  };
}

export function stagingChildEnvironments(inputs) {
  const profile = STAGING_GATE_PROFILE;
  return {
    dashboard: {
      OPERATIONS_BENCHMARK_API_URL: inputs.apiUrl,
      OPERATIONS_BENCHMARK_ADMIN_EMAIL: inputs.adminEmail,
      OPERATIONS_BENCHMARK_ADMIN_PASSWORD: inputs.adminPassword,
      OPERATIONS_BENCHMARK_SAMPLES: profile.dashboardSamples,
      OPERATIONS_BENCHMARK_WARMUP: profile.dashboardWarmup,
      OPERATIONS_BENCHMARK_P95_THRESHOLD_MS: profile.dashboardP95ThresholdMs,
    },
    realtime: {
      OPERATIONS_LOAD_API_URL: inputs.apiUrl,
      OPERATIONS_LOAD_REALTIME_URL: `${inputs.apiUrl}/realtime`,
      OPERATIONS_LOAD_CLIENTS: profile.visitorClients,
      OPERATIONS_LOAD_PUBLISHERS: profile.publishers,
      OPERATIONS_LOAD_UPDATES_PER_SECOND: profile.updatesPerSecond,
      OPERATIONS_LOAD_ADMIN_CLIENTS: profile.adminClients,
      OPERATIONS_LOAD_ADMIN_EMAIL: inputs.adminEmail,
      OPERATIONS_LOAD_ADMIN_PASSWORD: inputs.adminPassword,
      OPERATIONS_LOAD_EVENT_SETTLE_MS: profile.eventSettleMs,
      OPERATIONS_LOAD_PRESENCE_DELTA_P95_THRESHOLD_MS:
        profile.presenceDeltaP95ThresholdMs,
    },
  };
}

export function lastAggregateJson(output, label) {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  try {
    return JSON.parse(lines.at(-1));
  } catch {
    throw new Error(`${label} did not return an aggregate JSON result`);
  }
}

function aggregateObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} aggregate must be an object`);
  }
  return value;
}

function aggregateNumber(value, key, label) {
  const number = value[key];
  if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) {
    throw new Error(`${label}.${key} must be a non-negative number`);
  }
  return number;
}

export function sanitizeDashboardAggregate(value) {
  const label = 'dashboard';
  const aggregate = aggregateObject(value, label);
  const sanitized = {
    samples: aggregateNumber(aggregate, 'samples', label),
    warmup: aggregateNumber(aggregate, 'warmup', label),
    p50Ms: aggregateNumber(aggregate, 'p50Ms', label),
    p95Ms: aggregateNumber(aggregate, 'p95Ms', label),
    maxMs: aggregateNumber(aggregate, 'maxMs', label),
    thresholdMs: aggregateNumber(aggregate, 'thresholdMs', label),
  };
  if (
    sanitized.samples !== Number(STAGING_GATE_PROFILE.dashboardSamples) ||
    sanitized.warmup !== Number(STAGING_GATE_PROFILE.dashboardWarmup) ||
    sanitized.thresholdMs !==
      Number(STAGING_GATE_PROFILE.dashboardP95ThresholdMs) ||
    sanitized.p50Ms > sanitized.p95Ms ||
    sanitized.p95Ms > sanitized.maxMs ||
    sanitized.p95Ms >= sanitized.thresholdMs
  ) {
    throw new Error('dashboard aggregate does not satisfy the staging profile');
  }
  return sanitized;
}

export function sanitizeRealtimeAggregate(value) {
  const label = 'realtime';
  const aggregate = aggregateObject(value, label);
  const failureCodes = aggregate.failureCodes;
  if (
    !failureCodes ||
    typeof failureCodes !== 'object' ||
    Array.isArray(failureCodes) ||
    Object.keys(failureCodes).length > 0
  ) {
    throw new Error('realtime.failureCodes must be an empty object on pass');
  }
  const sanitized = {
    requestedSockets: aggregateNumber(aggregate, 'requestedSockets', label),
    connectedSockets: aggregateNumber(aggregate, 'connectedSockets', label),
    successfulUpdates: aggregateNumber(aggregate, 'successfulUpdates', label),
    failures: aggregateNumber(aggregate, 'failures', label),
    failureCodes: {},
    connectP95Ms: aggregateNumber(aggregate, 'connectP95Ms', label),
    requestedAdminMaps: aggregateNumber(aggregate, 'requestedAdminMaps', label),
    connectedAdminMaps: aggregateNumber(aggregate, 'connectedAdminMaps', label),
    adminConnectP95Ms: aggregateNumber(aggregate, 'adminConnectP95Ms', label),
    adminMapsReceivingPresence: aggregateNumber(
      aggregate,
      'adminMapsReceivingPresence',
      label,
    ),
    adminPresenceEvents: aggregateNumber(
      aggregate,
      'adminPresenceEvents',
      label,
    ),
    presenceDeltaSamples: aggregateNumber(
      aggregate,
      'presenceDeltaSamples',
      label,
    ),
    presenceDeltaP95Ms: aggregateNumber(aggregate, 'presenceDeltaP95Ms', label),
    presenceDeltaP95ThresholdMs: aggregateNumber(
      aggregate,
      'presenceDeltaP95ThresholdMs',
      label,
    ),
    updateP95Ms: aggregateNumber(aggregate, 'updateP95Ms', label),
    updateBatchMs: aggregateNumber(aggregate, 'updateBatchMs', label),
  };
  const expectedVisitors = Number(STAGING_GATE_PROFILE.visitorClients);
  const expectedPublishers = Number(STAGING_GATE_PROFILE.publishers);
  const expectedAdmins = Number(STAGING_GATE_PROFILE.adminClients);
  const expectedDeltaThreshold = Number(
    STAGING_GATE_PROFILE.presenceDeltaP95ThresholdMs,
  );
  if (
    sanitized.requestedSockets !== expectedVisitors ||
    sanitized.connectedSockets !== expectedVisitors ||
    sanitized.successfulUpdates !== expectedPublishers ||
    sanitized.failures !== 0 ||
    sanitized.requestedAdminMaps !== expectedAdmins ||
    sanitized.connectedAdminMaps !== expectedAdmins ||
    sanitized.adminMapsReceivingPresence !== expectedAdmins ||
    sanitized.adminPresenceEvents < expectedAdmins ||
    sanitized.presenceDeltaSamples < expectedAdmins ||
    sanitized.presenceDeltaP95ThresholdMs !== expectedDeltaThreshold ||
    sanitized.presenceDeltaP95Ms >= expectedDeltaThreshold
  ) {
    throw new Error('realtime aggregate does not satisfy the staging profile');
  }
  return sanitized;
}
