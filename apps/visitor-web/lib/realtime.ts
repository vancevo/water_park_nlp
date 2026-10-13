import { io, type Socket } from 'socket.io-client';

interface SharedRealtimeConnection {
  socket: Socket;
  references: number;
}

const connections = new Map<string, SharedRealtimeConnection>();

export function acquireRealtime(accessToken: string) {
  let connection = connections.get(accessToken);
  if (!connection) {
    connection = {
      socket: io(
        process.env.NEXT_PUBLIC_REALTIME_URL ??
          'http://localhost:3000/realtime',
        {
          auth: { token: accessToken },
          transports: ['websocket'],
          reconnectionDelay: 1_000,
          reconnectionDelayMax: 5_000,
        },
      ),
      references: 0,
    };
    connections.set(accessToken, connection);
  }
  connection.references += 1;
  let released = false;
  return {
    socket: connection.socket,
    release() {
      if (released) return;
      released = true;
      connection.references -= 1;
      if (connection.references === 0) {
        connection.socket.disconnect();
        connections.delete(accessToken);
      }
    },
  };
}
