import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL
  || (import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin);

export function connectSocket(token, handlers = {}) {
  const socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
    timeout: 8000,
    autoConnect: true,
  });
  if (handlers.onConnect) socket.on('connect', handlers.onConnect);
  if (handlers.onReconnect) socket.io.on('reconnect', handlers.onReconnect);
  if (handlers.onError) socket.on('connect_error', handlers.onError);
  return socket;
}
