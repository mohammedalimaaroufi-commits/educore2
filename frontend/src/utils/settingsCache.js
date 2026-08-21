const VERSION = 1;
const PREFIX = 'educore:settings-cache:';

function key(teacherId, section) {
  return `${PREFIX}${teacherId}:${section}`;
}

export function readSettingsCache(teacherId, section, fallback = null) {
  if (!teacherId || !section) return fallback;
  try {
    const raw = localStorage.getItem(key(teacherId, section));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.version === VERSION ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export function writeSettingsCache(teacherId, section, data) {
  if (!teacherId || !section) return false;
  try {
    localStorage.setItem(key(teacherId, section), JSON.stringify({ version: VERSION, savedAt: Date.now(), data }));
    return true;
  } catch {
    return false;
  }
}

export function removeSettingsCache(teacherId, section) {
  if (!teacherId || !section) return;
  try { localStorage.removeItem(key(teacherId, section)); } catch { /* storage can be unavailable */ }
}
