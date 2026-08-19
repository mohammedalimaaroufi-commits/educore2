const DB_NAME = 'educore-local-data';
const DB_VERSION = 1;
const SNAPSHOTS = 'snapshots';
const API_CACHE = 'api-cache';
const OUTBOX = 'outbox';
const META = 'meta';

let dbPromise;

function isSupported() {
  return typeof indexedDB !== 'undefined';
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}

function openDb() {
  if (!isSupported()) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: 'teacherId' });
        if (!db.objectStoreNames.contains(API_CACHE)) db.createObjectStore(API_CACHE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to open IndexedDB'));
    }).catch(() => null);
  }
  return dbPromise;
}

export async function saveSnapshot(teacherId, snapshot) {
  const db = await openDb();
  if (!db || !teacherId || !snapshot) return false;
  const transaction = db.transaction(SNAPSHOTS, 'readwrite');
  transaction.objectStore(SNAPSHOTS).put({ teacherId, savedAt: Date.now(), snapshot });
  await transactionToPromise(transaction);
  return true;
}

export async function getSnapshot(teacherId) {
  const db = await openDb();
  if (!db || !teacherId) return null;
  const transaction = db.transaction(SNAPSHOTS, 'readonly');
  const result = await requestToPromise(transaction.objectStore(SNAPSHOTS).get(teacherId));
  return result?.snapshot || null;
}

export async function deleteSnapshot(teacherId) {
  const db = await openDb();
  if (!db || !teacherId) return;
  const transaction = db.transaction(SNAPSHOTS, 'readwrite');
  transaction.objectStore(SNAPSHOTS).delete(teacherId);
  await transactionToPromise(transaction);
}

export async function saveApiCache(key, teacherId, data) {
  const db = await openDb();
  if (!db || !key || !teacherId) return false;
  const transaction = db.transaction(API_CACHE, 'readwrite');
  transaction.objectStore(API_CACHE).put({ key: `${teacherId}:${key}`, savedAt: Date.now(), data });
  await transactionToPromise(transaction);
  return true;
}

export async function getApiCache(key, teacherId, ttlMs = 30 * 24 * 60 * 60 * 1000) {
  const db = await openDb();
  if (!db || !key || !teacherId) return null;
  const transaction = db.transaction(API_CACHE, 'readonly');
  const entry = await requestToPromise(transaction.objectStore(API_CACHE).get(`${teacherId}:${key}`));
  if (!entry || Date.now() - Number(entry.savedAt || 0) > ttlMs) return null;
  return entry.data;
}

export async function enqueueOutbox(teacherId, operation) {
  const db = await openDb();
  if (!db || !teacherId || !operation) return null;
  const id = operation.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const item = { ...operation, id, teacherId, createdAt: Date.now(), attempts: 0 };
  const transaction = db.transaction(OUTBOX, 'readwrite');
  transaction.objectStore(OUTBOX).put(item);
  await transactionToPromise(transaction);
  return item;
}

export async function listOutbox(teacherId) {
  const db = await openDb();
  if (!db || !teacherId) return [];
  const transaction = db.transaction(OUTBOX, 'readonly');
  const all = await requestToPromise(transaction.objectStore(OUTBOX).getAll());
  return all.filter((item) => item.teacherId === teacherId).sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeOutbox(id) {
  const db = await openDb();
  if (!db || !id) return;
  const transaction = db.transaction(OUTBOX, 'readwrite');
  transaction.objectStore(OUTBOX).delete(id);
  await transactionToPromise(transaction);
}

export async function updateOutbox(item) {
  const db = await openDb();
  if (!db || !item?.id) return;
  const transaction = db.transaction(OUTBOX, 'readwrite');
  transaction.objectStore(OUTBOX).put(item);
  await transactionToPromise(transaction);
}

export async function saveMeta(key, value) {
  const db = await openDb();
  if (!db || !key) return;
  const transaction = db.transaction(META, 'readwrite');
  transaction.objectStore(META).put({ key, value, updatedAt: Date.now() });
  await transactionToPromise(transaction);
}

export async function getMeta(key, fallback = null) {
  const db = await openDb();
  if (!db || !key) return fallback;
  const transaction = db.transaction(META, 'readonly');
  const result = await requestToPromise(transaction.objectStore(META).get(key));
  return result?.value ?? fallback;
}

export async function getLocalStats(teacherId) {
  const db = await openDb();
  if (!db || !teacherId) return { snapshot: false, cacheEntries: 0, queued: 0 };
  const transaction = db.transaction([SNAPSHOTS, API_CACHE, OUTBOX], 'readonly');
  const [snapshot, caches, outbox] = await Promise.all([
    requestToPromise(transaction.objectStore(SNAPSHOTS).get(teacherId)),
    requestToPromise(transaction.objectStore(API_CACHE).getAll()),
    requestToPromise(transaction.objectStore(OUTBOX).getAll()),
  ]);
  return {
    snapshot: Boolean(snapshot),
    cacheEntries: caches.filter((item) => item.key.startsWith(`${teacherId}:`)).length,
    queued: outbox.filter((item) => item.teacherId === teacherId).length,
  };
}

export async function clearTeacherDatabase(teacherId) {
  const db = await openDb();
  if (!db || !teacherId) return;
  const readTransaction = db.transaction([API_CACHE, OUTBOX], 'readonly');
  const [caches, outbox] = await Promise.all([
    requestToPromise(readTransaction.objectStore(API_CACHE).getAll()),
    requestToPromise(readTransaction.objectStore(OUTBOX).getAll()),
  ]);
  const transaction = db.transaction([SNAPSHOTS, API_CACHE, OUTBOX], 'readwrite');
  transaction.objectStore(SNAPSHOTS).delete(teacherId);
  const cacheStore = transaction.objectStore(API_CACHE);
  const outboxStore = transaction.objectStore(OUTBOX);
  caches.filter((item) => item.key.startsWith(`${teacherId}:`)).forEach((item) => cacheStore.delete(item.key));
  outbox.filter((item) => item.teacherId === teacherId).forEach((item) => outboxStore.delete(item.id));
  await transactionToPromise(transaction);
}
