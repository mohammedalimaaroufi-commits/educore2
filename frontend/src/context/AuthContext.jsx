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

const VALID_SUBSCRIPTION_PLANS = new Set(['trial', '6_months', 'yearly', 'lifetime']);

function normalizeSubscriptionSession(data) {
  const rawSubscription = data?.subscription || null;
  const hasTrialShape = rawSubscription?.trial_end_date && !rawSubscription.current_period_start && !rawSubscription.current_period_end;
  const shouldUseTrial = !rawSubscription
    || !VALID_SUBSCRIPTION_PLANS.has(String(rawSubscription.plan || '').trim())
    || (rawSubscription.plan === 'lifetime' && hasTrialShape);
  const subscription = shouldUseTrial
    ? { ...(rawSubscription || {}), plan: 'trial', status: rawSubscription?.status || 'active' }
    : rawSubscription;
  const subscriptionInfo = data?.subscriptionInfo
    ? { ...data.subscriptionInfo, plan: shouldUseTrial ? 'trial' : data.subscriptionInfo.plan, status: data.subscriptionInfo.status || subscription.status || 'active' }
    : { plan: subscription.plan, status: subscription.status || 'active', startDate: subscription.trial_start_date || null, endDate: subscription.trial_end_date || null, daysLeft: null, expired: false };
  const trialInfo = data?.trialInfo || (subscriptionInfo.plan === 'trial' && subscriptionInfo.endDate
    ? (() => {
        const daysLeft = Math.ceil((new Date(subscriptionInfo.endDate) - new Date()) / (1000 * 60 * 60 * 24));
        return { daysLeft, expired: daysLeft <= 0, alertLevel: daysLeft <= 1 ? 'critical' : daysLeft <= 4 ? 'warning' : 'none' };
      })()
    : null);
  return { ...data, subscription, trialInfo, subscriptionInfo };
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
      const normalized = normalizeSubscriptionSession(data);
      setTeacher(normalized.teacher);
      setSubscription(normalized.subscription);
      setTrialInfo(normalized.trialInfo || null);
      setSubscriptionInfo(normalized.subscriptionInfo || null);
      persistSession(normalized);
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

  const resetSubscriptionState = () => {
    setSubscription(null);
    setTrialInfo(null);
    setSubscriptionInfo(null);
  };

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('educore_token', data.token);
    resetSubscriptionState();
    setTeacher(data.teacher);
    persistTeacher(data.teacher);
    await refreshMe({ force: true });
  };

  const register = async (payload) => {
    const { data } = await api.post('/auth/register', payload);
    localStorage.setItem('educore_token', data.token);
    resetSubscriptionState();
    setTeacher(data.teacher);
    persistTeacher(data.teacher);
    await refreshMe({ force: true });
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
