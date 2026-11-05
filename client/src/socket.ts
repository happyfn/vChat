import { io, type Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL || undefined;

let socket: Socket | null = null;

export function getSocket(token: string): Socket {
  if (socket?.connected) return socket;
  if (socket) {
    socket.auth = { token };
    socket.connect();
    return socket;
  }
  socket = io(WS_URL || '/', {
    auth: { token },
    autoConnect: true,
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function emitAck<T = unknown>(
  s: Socket,
  event: string,
  payload?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    s.timeout(10000).emit(event, payload ?? {}, (err: Error | null, res: T) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}
