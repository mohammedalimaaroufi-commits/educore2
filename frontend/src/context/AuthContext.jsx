import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { getLocalFirst } from '../api/client';
import { flushOutbox, syncSnapshot } from '../utils/snapshotSync.js';
import { clearTeacherDatabase } from '../utils/localDb.js';
import {
  buildRequestKey,
  clearTeacherLocalData,
  readPendingProfile,
  readSessionCache,
  removePendingProfile,
  saveSessionCache,
  writeApiCache,
} from '../utils/localCache.js';

const AuthContext = createContext(null);

function readStoredTeacher() {
  try {
    const raw = localStorage.getItem('educore_teacher');
    return raw ? JSON.parse(raw) : null;
  } catch {
    localStorage.removeItem('educore_teacher');
    return null;
  }
}

function readInitialSession() {
  const storedTeacher = readStoredTeacher();
  if (!storedTeacher?.id) return { teacher: null };
  return readSessionCache(storedTeacher.id) || { teacher: storedTeacher };
}

function persistTeacher(teacher) {
  if (!teacher?.id) return;
  localStorage.setItem('educore_teacher', JSON.stringify(teacher));
}

export function AuthProvider({ children }) {
  const initialSession = readInitialSession();
  const [teacher, setTeacher] = useState(initialSession.teacher || null);
  const [subscription, setSubscription] = useState(initialSession.subscription || null);
  const [trialInfo, setTrialInfo] = useState(initialSession.trialInfo || null);
  const [subscriptionInfo, setSubscriptionInfo] = useState(initialSession.subscriptionInfo || null);
  const [loading, setLoading] = useState(!initialSession.teacher);
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);

  const persistSession = useCallback((session) => {
    if (!session?.teacher?.id) return;
    persistTeacher(session.teacher);
    saveSessionCache(session);
  }, []);

  const refreshMe = useCallback(async ({ force = false } = {}) => {
    const token = localStorage.getItem('educore_token');
    if (!token) {
      setLoading(false);
      return;
    }

    const applySession = (data) => {
      if (!data?.teacher?.id) return;
      setTeacher(data.teacher);
      setSubscription(data.subscription || null);
      setTrialInfo(data.trialInfo || null);
      setSubscriptionInfo(data.subscriptionInfo || null);
      persistSession(data);
    };

    try {
      const response = force ? await api.get('/auth/me') : await getLocalFirst('/auth/me');
      const { data } = response;
      applySession(data);
      const pendingProfile = readPendingProfile(data.teacher?.id);
      if (pendingProfile) {
        try {
          await api.patch('/settings/profile', pendingProfile);
          const syncedData = { ...data, teacher: { ...data.teacher, ...pendingProfile } };
          applySession(syncedData);
          writeApiCache(buildRequestKey({
            baseURL: import.meta.env.VITE_API_URL || '/api',
            url: '/auth/me',
          }), syncedData);
          removePendingProfile(data.teacher.id);
        } catch {
          // Keep the pending profile until the next successful connection.
        }
      }
      setOffline(Boolean(response.fromLocalCache));
      void flushOutbox(data.teacher?.id);
      void syncSnapshot(data.teacher?.id);
      if (response.fromLocalCache && !force) {
        void api.get('/auth/me').then(({ data: freshData }) => {
          applySession(freshData);
          setOffline(false);
        }).catch(() => undefined);
      }
    } catch {
      // Keep the locally cached session visible so the dashboard remains usable offline.
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, [persistSession]);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    if (!teacher?.id) return undefined;
    const timer = window.setInterval(() => {
      void flushOutbox(teacher.id);
      void syncSnapshot(teacher.id);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [teacher?.id]);

  useEffect(() => {
    const handleOnline = () => {
      setOffline(false);
      void refreshMe().then(() => {
        const currentTeacher = readStoredTeacher();
        if (currentTeacher?.id) {
          void flushOutbox(currentTeacher.id);
          void syncSnapshot(currentTeacher.id, { force: true });
        }
      });
    };
    const handleOffline = () => setOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refreshMe]);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('educore_token', data.token);
    setTeacher(data.teacher);
    persistTeacher(data.teacher);
    await refreshMe();
  };

  const register = async (payload) => {
    const { data } = await api.post('/auth/register', payload);
    localStorage.setItem('educore_token', data.token);
    setTeacher(data.teacher);
    persistTeacher(data.teacher);
    await refreshMe();
  };

  const updateLocalTeacher = useCallback((nextTeacher) => {
    if (!nextTeacher?.id) return;
    setTeacher(nextTeacher);
    persistTeacher(nextTeacher);
    saveSessionCache({ teacher: nextTeacher, subscription, trialInfo, subscriptionInfo });
  }, [persistSession, subscription, trialInfo, subscriptionInfo]);

  const clearLocalCache = useCallback(async () => {
    if (!teacher?.id) return;
    clearTeacherLocalData(teacher.id);
    await clearTeacherDatabase(teacher.id);
  }, [teacher?.id]);

  const logout = () => {
    localStorage.removeItem('educore_token');
    localStorage.removeItem('educore_teacher');
    setTeacher(null);
    setSubscription(null);
    setTrialInfo(null);
    setSubscriptionInfo(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{
      teacher,
      subscription,
      trialInfo,
      subscriptionInfo,
      loading,
      offline,
      login,
      register,
      logout,
      refreshMe,
      updateLocalTeacher,
      clearLocalCache,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
