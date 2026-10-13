/* global console, fetch, setTimeout */
import process from 'node:process';
import { performance } from 'node:perf_hooks';

import { io } from 'socket.io-client';

const apiBase = (
  process.env.OPERATIONS_LOAD_API_URL ?? 'http://127.0.0.1:3000'
).replace(/\/$/, '');
const realtimeUrl =
  process.env.OPERATIONS_LOAD_REALTIME_URL ?? `${apiBase}/realtime`;
const clients = Number(process.env.OPERATIONS_LOAD_CLIENTS ?? 100);
const publishers = Number(process.env.OPERATIONS_LOAD_PUBLISHERS ?? clients);
const updatesPerSecond = Number(
  process.env.OPERATIONS_LOAD_UPDATES_PER_SECOND ?? 100,
);
const reuseAuth = process.env.OPERATIONS_LOAD_REUSE_AUTH === 'true';
const holdSeconds = Number(process.env.OPERATIONS_LOAD_HOLD_SECONDS ?? 0);
const adminClients = Number(process.env.OPERATIONS_LOAD_ADMIN_CLIENTS ?? 0);
const adminEmail = process.env.OPERATIONS_LOAD_ADMIN_EMAIL?.trim();
const adminPassword = process.env.OPERATIONS_LOAD_ADMIN_PASSWORD;
const eventSettleMs = Number(
  process.env.OPERATIONS_LOAD_EVENT_SETTLE_MS ?? 500,
);
const presenceDeltaP95ThresholdMs = Number(
  process.env.OPERATIONS_LOAD_PRESENCE_DELTA_P95_THRESHOLD_MS ?? 2_000,
);

if (
  !Number.isInteger(clients) ||
  clients < 1 ||
  clients > 5_000 ||
  !Number.isInteger(publishers) ||
  publishers < 0 ||
  publishers > clients ||
  !Number.isInteger(updatesPerSecond) ||
  updatesPerSecond < 1 ||
  updatesPerSecond > 1_000 ||
  !Number.isInteger(holdSeconds) ||
  holdSeconds < 0 ||
  holdSeconds > 600 ||
  !Number.isInteger(adminClients) ||
  adminClients < 0 ||
  adminClients > 100 ||
  !Number.isInteger(eventSettleMs) ||
  eventSettleMs < 0 ||
  eventSettleMs > 30_000 ||
  !Number.isFinite(presenceDeltaP95ThresholdMs) ||
  presenceDeltaP95ThresholdMs <= 0 ||
  presenceDeltaP95ThresholdMs > 60_000
) {
  console.error(
    'clients must be 1..5000, publishers 0..clients, admin clients 0..100, settle time 0..30000ms and presence delta p95 threshold 1..60000ms',
  );
  process.exit(2);
}
if (adminClients > 0 && (!adminEmail || !adminPassword)) {
  console.error(
    'OPERATIONS_LOAD_ADMIN_EMAIL and OPERATIONS_LOAD_ADMIN_PASSWORD are required when admin clients are enabled',
  );
  process.exit(2);
}

const percentile = (values, ratio) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  ];
};

async function json(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  if (response.status === 204) return undefined;
  return response.json();
}

const connect = (token) =>
  new Promise((resolve, reject) => {
    const started = performance.now();
    const socket = io(realtimeUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5_000,
    });
    socket.once('connect', () =>
      resolve({ socket, durationMs: performance.now() - started }),
    );
    socket.once('connect_error', (error) => {
      socket.disconnect();
      reject(error);
    });
  });

const records = [];
const failures = [];
const connectDurations = [];
const updateDurations = [];
const adminRecords = [];
const adminConnectDurations = [];
const presenceDeltaDurations = [];

try {
  if (adminClients > 0) {
    const adminAuth = await json('/v1/auth/login', {
      method: 'POST',
      body: { email: adminEmail, password: adminPassword },
    });
    for (let offset = 0; offset < adminClients; offset += 10) {
      const batch = Array.from(
        { length: Math.min(10, adminClients - offset) },
        async () => {
          try {
            const connected = await connect(adminAuth.accessToken);
            const record = { socket: connected.socket, presenceEvents: 0 };
            connected.socket.on('presence.delta.v1', (event) => {
              record.presenceEvents += 1;
              const occurredAt = Date.parse(event?.occurredAt);
              if (Number.isFinite(occurredAt)) {
                presenceDeltaDurations.push(
                  Math.max(0, Date.now() - occurredAt),
                );
              } else {
                failures.push('ADMIN_MAP_INVALID_EVENT_TIME');
              }
            });
            adminConnectDurations.push(connected.durationMs);
            adminRecords.push(record);
          } catch (error) {
            failures.push(error instanceof Error ? error.message : 'UNKNOWN');
          }
        },
      );
      await Promise.all(batch);
    }
  }

  const sharedAuth = reuseAuth
    ? await json('/v1/demo-auth/phone-session', {
        method: 'POST',
        body: { phone: '0900000099' },
      })
    : undefined;
  for (let offset = 0; offset < clients; offset += 25) {
    const batch = Array.from(
      { length: Math.min(25, clients - offset) },
      async (_, batchIndex) => {
        const index = offset + batchIndex;
        try {
          const phone = `09${String(10_000_000 + index).padStart(8, '0')}`;
          const auth =
            sharedAuth ??
            (await json('/v1/demo-auth/phone-session', {
              method: 'POST',
              body: { phone },
            }));
          const presence =
            index < publishers
              ? await json('/v1/me/presence/sessions', {
                  method: 'POST',
                  token: auth.accessToken,
                  body: { consentVersion: 'load-v1', shareIdentity: false },
                })
              : undefined;
          const connected = await connect(auth.accessToken);
          connectDurations.push(connected.durationMs);
          records.push({
            token: auth.accessToken,
            socket: connected.socket,
            presence,
            index,
          });
        } catch (error) {
          failures.push(error instanceof Error ? error.message : 'UNKNOWN');
        }
      },
    );
    await Promise.all(batch);
  }

  const startedUpdates = performance.now();
  const activePublishers = records.filter((record) => record.presence);
  for (
    let offset = 0;
    offset < activePublishers.length;
    offset += updatesPerSecond
  ) {
    const batch = activePublishers.slice(offset, offset + updatesPerSecond);
    await Promise.all(
      batch.map(async (record) => {
        const started = performance.now();
        try {
          await json(
            `/v1/me/presence/sessions/${record.presence.id}/locations`,
            {
              method: 'POST',
              token: record.token,
              body: {
                sessionId: record.presence.id,
                sequence: 1,
                latitude: 10.759 + (record.index % 100) * 0.0001,
                longitude: 106.635 + (record.index % 80) * 0.0001,
                accuracyMeters: 8,
                occurredAt: new Date().toISOString(),
              },
            },
          );
          updateDurations.push(performance.now() - started);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : 'UNKNOWN');
        }
      }),
    );
    if (offset + updatesPerSecond < activePublishers.length) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  if (adminClients > 0 && activePublishers.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, eventSettleMs));
    for (const record of adminRecords) {
      if (record.presenceEvents === 0) failures.push('ADMIN_MAP_NO_EVENT');
    }
  }

  const presenceDeltaP95Ms = Math.round(
    percentile(presenceDeltaDurations, 0.95),
  );
  if (adminClients > 0 && presenceDeltaP95Ms >= presenceDeltaP95ThresholdMs) {
    failures.push('PRESENCE_DELTA_P95_THRESHOLD_EXCEEDED');
  }

  console.log(
    JSON.stringify({
      requestedSockets: clients,
      connectedSockets: records.length,
      successfulUpdates: updateDurations.length,
      failures: failures.length,
      failureCodes: Object.fromEntries(
        [...new Set(failures)].map((code) => [
          code,
          failures.filter((value) => value === code).length,
        ]),
      ),
      connectP95Ms: Math.round(percentile(connectDurations, 0.95)),
      requestedAdminMaps: adminClients,
      connectedAdminMaps: adminRecords.length,
      adminConnectP95Ms: Math.round(percentile(adminConnectDurations, 0.95)),
      adminMapsReceivingPresence: adminRecords.filter(
        (record) => record.presenceEvents > 0,
      ).length,
      adminPresenceEvents: adminRecords.reduce(
        (total, record) => total + record.presenceEvents,
        0,
      ),
      presenceDeltaSamples: presenceDeltaDurations.length,
      presenceDeltaP95Ms,
      presenceDeltaP95ThresholdMs,
      updateP95Ms: Math.round(percentile(updateDurations, 0.95)),
      updateBatchMs: Math.round(performance.now() - startedUpdates),
    }),
  );
  if (
    failures.length > 0 ||
    records.length !== clients ||
    adminRecords.length !== adminClients
  ) {
    process.exitCode = 1;
  }
  if (holdSeconds > 0 && process.exitCode !== 1) {
    await new Promise((resolve) => setTimeout(resolve, holdSeconds * 1_000));
  }
} finally {
  await Promise.allSettled(
    records
      .filter((record) => record.presence)
      .map((record) =>
        json(`/v1/me/presence/sessions/${record.presence.id}`, {
          method: 'DELETE',
          token: record.token,
        }),
      ),
  );
  for (const record of records) record.socket.disconnect();
  for (const record of adminRecords) record.socket.disconnect();
}
