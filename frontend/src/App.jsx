import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { useLocale } from './context/LocaleContext.jsx';
import LoadingOverlay from './components/LoadingOverlay.jsx';

const ASSET_RECOVERY_KEY = 'educore-asset-recovery-attempted-at';
const ASSET_RECOVERY_COOLDOWN_MS = 30_000;
const CHUNK_ERROR_PATTERN = /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|module script failed/i;

function getAssetRecoveryTimestamp() {
  try { return Number(sessionStorage.getItem(ASSET_RECOVERY_KEY)); } catch { return 0; }
}

function markAssetRecovery() {
  try { sessionStorage.setItem(ASSET_RECOVERY_KEY, String(Date.now())); } catch { /* storage may be unavailable */ }
}

function hasRecentAssetRecovery() {
  const attemptedAt = getAssetRecoveryTimestamp();
  return attemptedAt === 1 || (Number.isFinite(attemptedAt) && Date.now() - attemptedAt < ASSET_RECOVERY_COOLDOWN_MS);
}

async function refreshAppAssets() {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.update().catch(() => undefined)));
    }
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.filter((name) => name.startsWith('educore-shell-') || name.startsWith('educore-runtime-')).map((name) => caches.delete(name)));
    }
  } catch {
    // A normal reload is still useful when the browser blocks cache or SW access.
  }
}

function recoverAndReload() {
  markAssetRecovery();
  void refreshAppAssets().finally(() => window.location.reload());
}

function lazyWithAssetRecovery(importer) {
  return React.lazy(() => importer().catch(async (error) => {
    const alreadyAttempted = hasRecentAssetRecovery();
    if (!alreadyAttempted && CHUNK_ERROR_PATTERN.test(String(error?.message || error))) {
      markAssetRecovery();
      await refreshAppAssets();
      window.location.reload();
    }
    throw error;
  }));
}

function AppErrorFallback() {
  const { t, locale } = useLocale();
  return <main className="min-h-screen flex items-center justify-center bg-surface px-6" dir={locale === 'ar' ? 'rtl' : 'ltr'}><section className="card max-w-md w-full p-8 text-center"><h1 className="text-xl font-bold text-ink mb-3">{t('appLoadErrorTitle')}</h1><p className="text-sm text-ink/60 mb-6">{t('appLoadErrorDescription')}</p><button type="button" className="btn-primary" onClick={recoverAndReload}>{t('retry')}</button></section></main>;
}

class AppErrorBoundary extends React.Component {
  componentDidCatch(error, info) {
    console.error('[EduCore] application render error', error, info?.componentStack || '');
  }

  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <AppErrorFallback />;
  }
}

const Login = lazyWithAssetRecovery(() => import('./pages/Login.jsx'));
const Register = lazyWithAssetRecovery(() => import('./pages/Register.jsx'));
const ForgotPassword = lazyWithAssetRecovery(() => import('./pages/ForgotPassword.jsx'));
const ResetPassword = lazyWithAssetRecovery(() => import('./pages/ResetPassword.jsx'));
const Dashboard = lazyWithAssetRecovery(() => import('./pages/Dashboard.jsx'));
const ClassDetail = lazyWithAssetRecovery(() => import('./pages/ClassDetail.jsx'));
const Subscription = lazyWithAssetRecovery(() => import('./pages/Subscription.jsx'));
const Settings = lazyWithAssetRecovery(() => import('./pages/Settings.jsx'));
const AdminLogin = lazyWithAssetRecovery(() => import('./pages/AdminLogin.jsx'));
const AdminDashboard = lazyWithAssetRecovery(() => import('./pages/AdminDashboard.jsx'));
const ChatWidget = lazyWithAssetRecovery(() => import('./components/ChatWidget.jsx'));
const OnboardingTutorial = lazyWithAssetRecovery(() => import('./components/OnboardingTutorial.jsx'));
const PublicAnnouncement = lazyWithAssetRecovery(() => import('./components/PublicAnnouncement.jsx'));

function LoadingScreen() {
  return <LoadingOverlay />;
}

function OfflineBanner() {
  const { offline } = useAuth();
  const { t } = useLocale();
  if (!offline) return null;
  return <div className="sticky top-0 z-50 bg-amber-100 text-amber-900 border-b border-amber-200 px-4 py-2 text-center text-xs">{t('offline')}</div>;
}

function ProtectedRoute({ children }) {
  const { teacher, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!teacher) return <Navigate to="/login" replace />;
  return (
    <div className="protected-app-shell">
      <OfflineBanner />
      <Suspense fallback={null}><PublicAnnouncement placement="global" /></Suspense>
      <div className="protected-app-content">{children}</div>
      <Suspense fallback={null}><ChatWidget /></Suspense>
      <Suspense fallback={null}><OnboardingTutorial /></Suspense>
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/classes/:id" element={<ProtectedRoute><ClassDetail /></ProtectedRoute>} />
        <Route path="/subscription" element={<ProtectedRoute><Subscription /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  );
}
