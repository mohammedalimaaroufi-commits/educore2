import axios from 'axios';
import {
  buildRequestKey,
  getTeacherId,
  readApiCache,
  readSessionCache,
  writeApiCache,
} from '../utils/localCache.js';
import { getApiCache, saveApiCache } from '../utils/localDb.js';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20_000,
});

function canUseLocalCache(config = {}) {
  const method = String(config.method || 'get').toLowerCase();
  const url = String(config.url || '');
  return method === 'get'
    && !url.startsWith('/admin')
    && !url.startsWith('/backup')
    && !url.includes('/auth/plans')
    && !url.includes('/payment-requests');
}

function localCacheKey(url, config = {}) {
  return buildRequestKey({ baseURL: api.defaults.baseURL, url, params: config.params });
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('educore_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => {
    if (canUseLocalCache(res.config)) {
      const requestKey = buildRequestKey(res.config);
      writeApiCache(requestKey, res.data);
      void saveApiCache(requestKey, getTeacherId(), res.data);
    }
    return res;
  },
  async (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('educore_token');
      localStorage.removeItem('educore_teacher');
      window.location.href = '/login';
      return Promise.reject(err);
    }

    const config = err.config;
    if ((!err.response || err.response.status >= 500) && canUseLocalCache(config)) {
      const requestKey = buildRequestKey(config);
      const indexedData = await getApiCache(requestKey, getTeacherId());
      const cachedData = indexedData ?? readApiCache(requestKey);
      if (cachedData !== null) {
        return {
          data: cachedData,
          status: 200,
          statusText: 'OK (local cache)',
          headers: {},
          config,
          request: null,
          fromLocalCache: true,
        };
      }
    }

    return Promise.reject(err);
  },
);

export async function getLocalFirst(url, config = {}) {
  const requestKey = localCacheKey(url, config);
  const teacherId = getTeacherId();
  const indexedData = await getApiCache(requestKey, teacherId);
  const cachedData = indexedData ?? readApiCache(requestKey);
  if (cachedData !== null) {
    // Revalidate without blocking the first paint. The response interceptor updates both caches.
    void api.get(url, config).catch(() => undefined);
    return {
      data: cachedData,
      status: 200,
      statusText: 'OK (local-first cache)',
      headers: {},
      config: { ...config, baseURL: api.defaults.baseURL, url },
      request: null,
      fromLocalCache: true,
    };
  }
  return api.get(url, config);
}

export default api;
