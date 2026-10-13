import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { INestApplicationContext } from '@nestjs/common';
import type { Server, ServerOptions } from 'socket.io';
import { createClient } from 'redis';

export class RedisIoAdapter extends IoAdapter {
  private publisher?: ReturnType<typeof createClient>;
  private subscriber?: ReturnType<typeof createClient>;

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string,
  ) {
    super(app);
  }

  async connect(): Promise<boolean> {
    const publisher = createClient({
      url: this.redisUrl,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 1_000,
        reconnectStrategy: (retries) => Math.min(100 * 2 ** retries, 2_000),
      },
    });
    const subscriber = publisher.duplicate();
    publisher.on('error', () => undefined);
    subscriber.on('error', () => undefined);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.all([publisher.connect(), subscriber.connect()]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('REDIS_CONNECT_TIMEOUT')),
            1_500,
          );
        }),
      ]);
      this.publisher = publisher;
      this.subscriber = subscriber;
      return true;
    } catch {
      if (publisher.isOpen) publisher.destroy();
      if (subscriber.isOpen) subscriber.destroy();
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options);
    if (this.publisher && this.subscriber) {
      server.adapter(createAdapter(this.publisher, this.subscriber));
    }
    return server;
  }

  async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.allSettled([
      this.publisher?.isReady ? this.publisher.quit() : Promise.resolve(),
      this.subscriber?.isReady ? this.subscriber.quit() : Promise.resolve(),
    ]);
    if (this.publisher?.isOpen) this.publisher.destroy();
    if (this.subscriber?.isOpen) this.subscriber.destroy();
  }
}
