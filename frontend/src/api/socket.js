import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL
  || (import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin);

const sharedSockets = new Map();

function socketKey(token) {
  return token ? `auth:${token}` : 'public';
}

function detachHandlers(socket, handlers = {}) {
  if (handlers.onConnect) socket.off('connect', handlers.onConnect);
  if (handlers.onReconnect) socket.io.off('reconnect', handlers.onReconnect);
  if (handlers.onError) socket.off('connect_error', handlers.onError);
}

export function connectSocket(token, handlers = {}) {
  const key = socketKey(token);
  let entry = sharedSockets.get(key);
  if (!entry) {
    const socket = io(SOCKET_URL, {
      auth: token ? { token } : { public: true },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 8000,
      autoConnect: true,
    });
    entry = { socket, refs: 0 };
    sharedSockets.set(key, entry);
  }
  entry.refs += 1;
  const { socket } = entry;
  if (handlers.onConnect) socket.on('connect', handlers.onConnect);
  if (handlers.onReconnect) socket.io.on('reconnect', handlers.onReconnect);
  if (handlers.onError) socket.on('connect_error', handlers.onError);
  return socket;
}

export function releaseSocket(socket, handlers = {}) {
  if (!socket) return;
  detachHandlers(socket, handlers);
  const entry = [...sharedSockets.values()].find((item) => item.socket === socket);
  if (!entry) {
    socket.disconnect();
    return;
  }
  entry.refs -= 1;
  if (entry.refs <= 0) {
    socket.disconnect();
    for (const [key, value] of sharedSockets.entries()) {
      if (value === entry) sharedSockets.delete(key);
    }
  }
}

export function getSocketStats() {
  return [...sharedSockets.entries()].map(([key, entry]) => ({ key, refs: entry.refs, connected: entry.socket.connected }));
}
