/* global console, fetch */
import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

import { ADMIN_EMAIL, ADMIN_PASSWORD, repoRoot } from './demo/lib.mjs';

const startedAt = new Date();
const apiBase = (
  process.env.OPERATIONS_LOCAL_ACCEPTANCE_API_URL ?? 'http://127.0.0.1:3000'
).replace(/\/$/, '');
const adminEmail =
  process.env.OPERATIONS_LOCAL_ACCEPTANCE_ADMIN_EMAIL ?? ADMIN_EMAIL;
const adminPassword =
  process.env.OPERATIONS_LOCAL_ACCEPTANCE_ADMIN_PASSWORD ?? ADMIN_PASSWORD;
const target = new URL(apiBase);
const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);

if (target.protocol !== 'http:' || !localHosts.has(target.hostname)) {
  console.error('Local acceptance only accepts an HTTP loopback API URL');
  process.exit(2);
}

const stamp = startedAt.toISOString().replaceAll(':', '-').replaceAll('.', '-');
const reportPath = resolve(
  process.env.OPERATIONS_LOCAL_ACCEPTANCE_REPORT ??
    `${repoRoot}/deliverables/operations-local-acceptance-${stamp}.json`,
);
const checks = {
  catalog: false,
  phoneSession: false,
  payment: false,
  loyaltyCredit: false,
  rewardRedemption: false,
  paymentFeed: false,
  dashboardReconcile: false,
  presenceOptIn: false,
  presenceOptOut: false,
  piiBoundary: false,
};

let presence;
let visitorToken;

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

async function request(label, path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  const expected = options.expected ?? [200];
  if (!expected.includes(response.status)) {
    throw new Error(
      `${label.toUpperCase().replaceAll(' ', '_')}_HTTP_${response.status}`,
    );
  }
  return response.status === 204 ? undefined : response.json();
}

async function writeReport(status, errorCode) {
  const report = {
    schemaVersion: 1,
    kind: 'operations-local-acceptance',
    scope: 'local-demo-only',
    status,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    checks,
    ...(errorCode ? { errorCode } : {}),
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  return report;
}

try {
  await request('health', '/health');
  const admin = await request('admin login', '/v1/auth/login', {
    method: 'POST',
    body: { email: adminEmail, password: adminPassword },
  });
  const before = await request(
    'dashboard before',
    '/v1/admin/dashboard/summary',
    { token: admin.accessToken },
  );

  const phone = `090${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
  const visitor = await request(
    'phone session',
    '/v1/demo-auth/phone-session',
    { method: 'POST', body: { phone } },
  );
  visitorToken = visitor.accessToken;
  checks.phoneSession =
    visitor.user.authMethods?.includes('demo_phone') === true;

  const products = await request(
    'ticket catalog',
    '/v1/cashier/ticket-products',
    { token: admin.accessToken },
  );
  const rewards = await request('reward catalog', '/v1/rewards');
  const product =
    products.find((candidate) => candidate.code === 'DEMO_ADULT') ??
    products[0];
  const reward = rewards
    .filter((candidate) => candidate.pointsCost <= product.pointsPerItem)
    .sort((left, right) => left.pointsCost - right.pointsCost)[0];
  assert(product && reward, 'CATALOG_INCOMPLETE');
  checks.catalog = products.length >= 1 && rewards.length >= 1;

  const customer = await request(
    'customer lookup',
    '/v1/cashier/customer-lookups',
    { method: 'POST', token: admin.accessToken, body: { phone } },
  );
  const order = await request(
    'create payment order',
    '/v1/cashier/payment-orders',
    {
      method: 'POST',
      token: admin.accessToken,
      expected: [201],
      body: {
        customerToken: customer.customerToken,
        idempotencyKey: randomUUID(),
        items: [{ ticketProductId: product.id, quantity: 1 }],
      },
    },
  );
  const qrToken = order.qrUrl?.split('/').at(-1);
  assert(qrToken, 'PAYMENT_QR_MISSING');
  const paid = await request(
    'confirm payment',
    `/v1/demo-payments/${qrToken}/confirm`,
    { method: 'POST', body: { idempotencyKey: randomUUID() } },
  );
  checks.payment =
    paid.status === 'succeeded' &&
    paid.totalAmountVnd === product.amountVnd &&
    paid.totalPoints === product.pointsPerItem;

  const loyalty = await request('loyalty after payment', '/v1/me/loyalty', {
    token: visitorToken,
  });
  checks.loyaltyCredit =
    loyalty.balance === product.pointsPerItem &&
    loyalty.entries.filter(
      (entry) => entry.entryType === 'payment_credit' && entry.delta > 0,
    ).length === 1;

  await request('reward redemption', '/v1/me/reward-redemptions', {
    method: 'POST',
    token: visitorToken,
    expected: [201],
    body: { rewardId: reward.id, idempotencyKey: randomUUID() },
  });
  const afterReward = await request('loyalty after reward', '/v1/me/loyalty', {
    token: visitorToken,
  });
  checks.rewardRedemption =
    afterReward.balance === product.pointsPerItem - reward.pointsCost &&
    afterReward.entries.filter(
      (entry) => entry.entryType === 'redemption_debit' && entry.delta < 0,
    ).length === 1;

  const feed = await request(
    'payment feed',
    '/v1/admin/dashboard/recent-payments?limit=50',
    { token: admin.accessToken },
  );
  checks.paymentFeed = feed.items.some(
    (item) =>
      item.id === order.id &&
      item.status === 'succeeded' &&
      item.totalAmountVnd === product.amountVnd,
  );
  const after = await request(
    'dashboard after',
    '/v1/admin/dashboard/summary',
    { token: admin.accessToken },
  );
  checks.dashboardReconcile =
    after.simulatedRevenue.todayVnd - before.simulatedRevenue.todayVnd ===
      product.amountVnd && after.payingUsersToday >= before.payingUsersToday;

  presence = await request('presence opt in', '/v1/me/presence/sessions', {
    method: 'POST',
    token: visitorToken,
    expected: [201],
    body: { consentVersion: 'demo-v1', shareIdentity: false },
  });
  await request(
    'presence location',
    `/v1/me/presence/sessions/${presence.id}/locations`,
    {
      method: 'POST',
      token: visitorToken,
      expected: [204],
      body: {
        sessionId: presence.id,
        sequence: 1,
        latitude: 10.76433,
        longitude: 106.63853,
        accuracyMeters: 8,
        occurredAt: new Date().toISOString(),
      },
    },
  );
  const snapshot = await request('presence snapshot', '/v1/admin/presence', {
    token: admin.accessToken,
  });
  checks.presenceOptIn = snapshot.items.some(
    (item) => item.sessionId === presence.id,
  );
  const presenceId = presence.id;
  await request('presence opt out', `/v1/me/presence/sessions/${presenceId}`, {
    method: 'DELETE',
    token: visitorToken,
    expected: [204],
  });
  presence = undefined;
  const afterStop = await request(
    'presence after opt out',
    '/v1/admin/presence',
    { token: admin.accessToken },
  );
  checks.presenceOptOut = !afterStop.items.some(
    (item) => item.sessionId === presenceId,
  );

  const inspected = JSON.stringify({ visitor, customer, paid, loyalty, feed });
  checks.piiBoundary =
    !inspected.includes(phone) && !inspected.includes(qrToken);
  assert(Object.values(checks).every(Boolean), 'LOCAL_ACCEPTANCE_CHECK_FAILED');

  const report = await writeReport('passed');
  console.log(JSON.stringify({ ...report, reportPath }));
} catch (error) {
  if (presence && visitorToken) {
    await fetch(`${apiBase}/v1/me/presence/sessions/${presence.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${visitorToken}` },
    }).catch(() => undefined);
  }
  const errorCode =
    error instanceof Error &&
    /^[A-Z0-9_]+(?:_HTTP_[0-9]{3})?$/.test(error.message)
      ? error.message
      : 'LOCAL_ACCEPTANCE_FAILED';
  const report = await writeReport('failed', errorCode).catch(() => undefined);
  console.error(
    JSON.stringify({
      status: 'failed',
      errorCode,
      ...(report ? { reportPath } : {}),
    }),
  );
  process.exitCode = 1;
}
