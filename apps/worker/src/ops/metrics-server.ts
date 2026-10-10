import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { MetricsRegistry } from './metrics.js';

/**
 * Prometheus scrape endpoint for the worker (AI08 / C07, ADR 0013 follow-up).
 *
 * Serves only:
 * - `GET /metrics` → `MetricsRegistry.toPrometheus()` (text exposition v0.0.4)
 * - `GET /healthz` → `ok` (liveness for the container/orchestrator)
 *
 * The endpoint exposes the same low-cardinality operational series the
 * registry already sanitizes — never a transcript, prompt, query or raw GPS.
 * It binds to loopback by default; set `WORKER_METRICS_HOST=0.0.0.0` only on a
 * private network that the scraper reaches (it has no authentication).
 */

export const PROMETHEUS_CONTENT_TYPE =
  'text/plain; version=0.0.4; charset=utf-8';

export interface MetricsServerConfig {
  enabled: boolean;
  host: string;
  port: number;
}

export class MetricsServerConfigError extends Error {
  constructor(message: string) {
    super(`worker metrics config: ${message}`);
    this.name = 'MetricsServerConfigError';
  }
}

export function loadMetricsServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): MetricsServerConfig {
  const rawEnabled = env.WORKER_METRICS_ENABLED?.trim().toLowerCase();
  if (
    rawEnabled !== undefined &&
    rawEnabled !== '' &&
    rawEnabled !== 'true' &&
    rawEnabled !== 'false'
  )
    throw new MetricsServerConfigError(
      'WORKER_METRICS_ENABLED must be "true" or "false"',
    );
  const rawPort = env.WORKER_METRICS_PORT?.trim();
  const port = rawPort ? Number(rawPort) : 9464;
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new MetricsServerConfigError(
      'WORKER_METRICS_PORT must be an integer between 0 and 65535',
    );
  return {
    enabled: rawEnabled !== 'false',
    host: env.WORKER_METRICS_HOST?.trim() || '127.0.0.1',
    port,
  };
}

export interface RunningMetricsServer {
  server: Server;
  /** Bound port (useful when configured with port 0). */
  port: number;
  close(): Promise<void>;
}

export function createMetricsServer(registry: MetricsRegistry): Server {
  return createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path !== '/metrics' && path !== '/healthz') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found\n');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, {
        allow: 'GET, HEAD',
        'content-type': 'text/plain; charset=utf-8',
      });
      res.end('method not allowed\n');
      return;
    }
    const body = path === '/metrics' ? registry.toPrometheus() : 'ok\n';
    res.writeHead(200, {
      'content-type':
        path === '/metrics'
          ? PROMETHEUS_CONTENT_TYPE
          : 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

export function startMetricsServer(
  registry: MetricsRegistry,
  config: Pick<MetricsServerConfig, 'host' | 'port'>,
): Promise<RunningMetricsServer> {
  const server = createMetricsServer(registry);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      const { port } = server.address() as AddressInfo;
      resolve({
        server,
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
