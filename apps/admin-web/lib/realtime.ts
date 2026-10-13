import { io } from 'socket.io-client';

export function connectRealtime(accessToken: string) {
  return io(
    process.env.NEXT_PUBLIC_REALTIME_URL ?? 'http://localhost:3000/realtime',
    {
      auth: { token: accessToken },
      transports: ['websocket'],
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 5_000,
    },
  );
}
