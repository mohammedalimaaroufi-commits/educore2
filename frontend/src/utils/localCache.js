const CACHE_PREFIX = 'educore:api-cache:';
const PROFILE_DRAFT_PREFIX = 'educore:profile-draft:';
const PENDING_PROFILE_PREFIX = 'educore:profile-pending:';
const CACHE_VERSION = 1;
const MAX_ENTRY_BYTES = 750_000;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function safeRead(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWrite(key, value) {
  try {
    const raw = JSON.stringify(value);
    if (raw.length > MAX_ENTRY_BYTES) return false;
    localStorage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage can be disabled by the browser; the app still works online.
  }
}

export function getTeacherId() {
  const teacher = safeRead('educore_teacher');
  return teacher?.id || 'anonymous';
}

export function buildRequestKey(config = {}) {
  const baseURL = config.baseURL || '';
  const url = config.url || '';
  const params = config.params && typeof config.params === 'object'
    ? Object.keys(config.params).sort().map((key) => `${key}=${String(config.params[key])}`).join('&')
    : '';
  return `${baseURL}${url}${params ? `?${params}` : ''}`;
}

function cacheKey(requestKey, teacherId = getTeacherId()) {
  return `${CACHE_PREFIX}${teacherId}:${encodeURIComponent(requestKey)}`;
}

export function writeApiCache(requestKey, data, teacherId = getTeacherId()) {
  return safeWrite(cacheKey(requestKey, teacherId), {
    version: CACHE_VERSION,
    savedAt: Date.now(),
    data,
  });
}

export function readApiCache(requestKey, teacherId = getTeacherId(), ttlMs = DEFAULT_TTL_MS) {
  const cached = safeRead(cacheKey(requestKey, teacherId));
  if (!cached || cached.version !== CACHE_VERSION || !('data' in cached)) return null;
  if (Date.now() - Number(cached.savedAt || 0) > ttlMs) return null;
  return cached.data;
}

export function saveSessionCache(session) {
  if (!session?.teacher?.id) return false;
  return safeWrite(`educore:session:${session.teacher.id}`, {
    version: CACHE_VERSION,
    savedAt: Date.now(),
    ...session,
  });
}

export function readSessionCache(teacherId = getTeacherId()) {
  const cached = safeRead(`educore:session:${teacherId}`);
  if (!cached || cached.version !== CACHE_VERSION || !cached.teacher) return null;
  return cached;
}

export function saveProfileDraft(teacherId, profile) {
  if (!teacherId || !profile) return false;
  return safeWrite(`${PROFILE_DRAFT_PREFIX}${teacherId}`, {
    version: CACHE_VERSION,
    savedAt: Date.now(),
    profile,
  });
}

export function readProfileDraft(teacherId) {
  if (!teacherId) return null;
  const cached = safeRead(`${PROFILE_DRAFT_PREFIX}${teacherId}`);
  return cached?.version === CACHE_VERSION ? cached.profile : null;
}

export function removeProfileDraft(teacherId) {
  if (teacherId) safeRemove(`${PROFILE_DRAFT_PREFIX}${teacherId}`);
}

export function savePendingProfile(teacherId, profile) {
  if (!teacherId || !profile) return false;
  return safeWrite(`${PENDING_PROFILE_PREFIX}${teacherId}`, {
    version: CACHE_VERSION,
    savedAt: Date.now(),
    profile,
  });
}

export function readPendingProfile(teacherId) {
  if (!teacherId) return null;
  const cached = safeRead(`${PENDING_PROFILE_PREFIX}${teacherId}`);
  return cached?.version === CACHE_VERSION ? cached.profile : null;
}

export function removePendingProfile(teacherId) {
  if (teacherId) safeRemove(`${PENDING_PROFILE_PREFIX}${teacherId}`);
}

export function clearTeacherLocalData(teacherId = getTeacherId()) {
  const prefixes = [
    `${CACHE_PREFIX}${teacherId}:`,
    `educore:session:${teacherId}`,
    `${PROFILE_DRAFT_PREFIX}${teacherId}`,
    `${PENDING_PROFILE_PREFIX}${teacherId}`,
  ];
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) keys.push(key);
    }
    keys.forEach(safeRemove);
  } catch {
    // Ignore disabled or unavailable storage.
  }
}

export function getTeacherLocalStats(teacherId = getTeacherId()) {
  let entries = 0;
  let bytes = 0;
  try {
    const prefix = `${CACHE_PREFIX}${teacherId}:`;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        entries += 1;
        bytes += (localStorage.getItem(key) || '').length;
      }
    }
  } catch {
    return { entries: 0, bytes: 0 };
  }
  return { entries, bytes };
}

export function formatBytes(bytes) {
  if (!bytes) return '0 كيلوبايت';
  if (bytes < 1024) return `${bytes} بايت`;
  return `${(bytes / 1024).toFixed(1)} كيلوبايت`;
}
