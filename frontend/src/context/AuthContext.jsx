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
const PLAN_ALIASES = {
  annual: 'yearly', year: 'yearly', '12_months': 'yearly', '12-months': 'yearly',
  '6_month': '6_months', '6months': '6_months', '6-months': '6_months',
  '6 أشهر': '6_months', 'باقة 6 أشهر': '6_months', 'ستة أشهر': '6_months',
  سنوية: 'yearly', 'باقة سنوية': 'yearly', 'الباقة السنوية': 'yearly',
  'مدى الحياة': 'lifetime', 'باقة مدى الحياة': 'lifetime', forever: 'lifetime', permanent: 'lifetime',
  trial: 'trial', 'free trial': 'trial', 'فترة تجريبية': 'trial', تجربة: 'trial',
};

function canonicalPlan(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase().normalize('NFKC');
  return VALID_SUBSCRIPTION_PLANS.has(normalized) ? normalized : PLAN_ALIASES[raw] || PLAN_ALIASES[normalized] || null;
}

function normalizeSubscriptionSession(data) {
  const rawSubscription = data?.subscription || null;
  const rawPlan = canonicalPlan(rawSubscription?.plan);
  const infoPlan = canonicalPlan(data?.subscriptionInfo?.plan);
  const rawLooksLikeTrial = rawPlan === 'trial' && Boolean(rawSubscription?.trial_end_date) && !rawSubscription?.current_period_start && !rawSubscription?.current_period_end;
  // A paid presentation from the server is stronger than a legacy trial row. This is
  // essential for accounts whose original trial row was updated asynchronously.
  const selectedPlan = infoPlan && infoPlan !== 'trial' && (rawLooksLikeTrial || !rawPlan) ? infoPlan : (rawPlan || infoPlan);
  const suppliedInfo = data?.subscriptionInfo || {};
  const startDate = suppliedInfo.startDate || (selectedPlan === 'trial' ? rawSubscription?.trial_start_date : rawSubscription?.current_period_start) || null;
  const endDate = suppliedInfo.endDate || (selectedPlan === 'trial' ? rawSubscription?.trial_end_date : rawSubscription?.current_period_end) || null;
  const calculatedDaysLeft = endDate ? Math.ceil((new Date(endDate) - new Date()) / (1000 * 60 * 60 * 24)) : null;
  const hasPaidPresentation = Boolean(infoPlan && infoPlan !== 'trial' && suppliedInfo.startDate);
  const shouldUseTrial = !selectedPlan || !VALID_SUBSCRIPTION_PLANS.has(selectedPlan) || (!hasPaidPresentation && selectedPlan === 'trial' && !endDate);
  const effectivePlan = shouldUseTrial ? 'trial' : selectedPlan;
  const subscription = {
    ...(rawSubscription || {}),
    plan: effectivePlan,
    status: suppliedInfo.status || rawSubscription?.status || 'active',
    ...(effectivePlan !== 'trial' && startDate ? { current_period_start: startDate, current_period_end: endDate, trial_start_date: null, trial_end_date: null } : {}),
  };
  const subscriptionInfo = {
    ...suppliedInfo,
    plan: effectivePlan,
    status: suppliedInfo.status || subscription.status || 'active',
    startDate,
    endDate,
    daysLeft: suppliedInfo.daysLeft ?? calculatedDaysLeft,
    expired: suppliedInfo.expired ?? (calculatedDaysLeft !== null && calculatedDaysLeft <= 0),
  };
  const restrictions = data?.restrictions || subscriptionInfo.restrictions || null;
  const trialInfo = data?.trialInfo || (subscriptionInfo.plan === 'trial' && subscriptionInfo.endDate
    ? (() => {
        const daysLeft = Math.ceil((new Date(subscriptionInfo.endDate) - new Date()) / (1000 * 60 * 60 * 24));
        return { daysLeft, expired: daysLeft <= 0, alertLevel: daysLeft <= 1 ? 'critical' : daysLeft <= 4 ? 'warning' : 'none' };
      })()
    : null);
  return { ...data, subscription, trialInfo, subscriptionInfo, restrictions };
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
  const [restrictions, setRestrictions] = useState(initialSession.restrictions || initialSession.subscriptionInfo?.restrictions || null);
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
      setRestrictions(normalized.restrictions || normalized.subscriptionInfo?.restrictions || null);
      persistSession(normalized);
    };

    try {
      const response = force ? await api.get('/auth/me', { params: { fresh: Date.now() } }) : await getLocalFirst('/auth/me');
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
    setRestrictions(null);
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
    saveSessionCache({ teacher: nextTeacher, subscription, trialInfo, subscriptionInfo, restrictions });
  }, [persistSession, subscription, trialInfo, subscriptionInfo, restrictions]);

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
    setRestrictions(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{
      teacher,
      subscription,
      trialInfo,
      subscriptionInfo,
      restrictions,
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
