import api from '../api/client';
import { connectSocket, releaseSocket } from '../api/socket';

const PUBLIC_CONFIG_CACHE_KEY = 'educore:public-config:v1';
const EMPTY_STATE = { announcement: null, notifications: [], loaded: false, revision: 0, lastEvent: null };

function readCachedConfig() {
  try {
    const raw = localStorage.getItem(PUBLIC_CONFIG_CACHE_KEY);
    const cached = raw ? JSON.parse(raw) : null;
    return cached && typeof cached === 'object' ? cached : null;
  } catch {
    return null;
  }
}

function writeCachedConfig(next) {
  try {
    localStorage.setItem(PUBLIC_CONFIG_CACHE_KEY, JSON.stringify({ announcement: next.announcement || null, notifications: next.notifications || [], saved_at: Date.now() }));
  } catch { /* storage may be unavailable */ }
}

const cachedConfig = readCachedConfig();
let state = { ...EMPTY_STATE, ...cachedConfig, loaded: Boolean(cachedConfig), revision: 0, lastEvent: null };
let started = false;
let refreshPromise = null;
let refreshTimer = null;
let socket = null;
const listeners = new Set();

function notify(next) {
  state = next;
  listeners.forEach((listener) => listener(state));
}

async function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = api.get('/auth/public-config')
    .then(({ data }) => {
      const next = { ...state, announcement: data?.announcement || null, notifications: Array.isArray(data?.notifications) ? data.notifications : [], loaded: true };
      writeCachedConfig(next);
      notify(next);
      return state;
    })
    .catch(() => state)
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

function handlePublicConfigUpdated(payload = {}) {
  notify({ ...state, revision: state.revision + 1, lastEvent: { ...payload, received_at: Date.now() } });
  void refresh();
}

function start() {
  if (started) return;
  started = true;
  void refresh();
  refreshTimer = window.setInterval(() => { void refresh(); }, 30 * 1000);
  const onFocus = () => { void refresh(); };
  const onVisibility = () => { if (document.visibilityState === 'visible') void refresh(); };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);
  socket = connectSocket(localStorage.getItem('educore_token') || '', { onReconnect: refresh });
  socket?.on('public_config_updated', handlePublicConfigUpdated);
  socketCleanup = () => {
    window.clearInterval(refreshTimer);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibility);
    socket?.off('public_config_updated', handlePublicConfigUpdated);
    releaseSocket(socket, { onReconnect: refresh });
    socket = null;
    socketCleanup = null;
    state = { ...state, lastEvent: null };
    started = false;
  };
}

let socketCleanup = null;

function stopIfUnused() {
  if (listeners.size === 0 && socketCleanup) socketCleanup();
}

export function getPublicConfigState() {
  return state;
}

export function subscribePublicConfig(listener) {
  if (typeof listener !== 'function') return () => undefined;
  listeners.add(listener);
  listener(state);
  start();
  return () => {
    listeners.delete(listener);
    stopIfUnused();
  };
}

export function refreshPublicConfig() {
  return refresh();
}
