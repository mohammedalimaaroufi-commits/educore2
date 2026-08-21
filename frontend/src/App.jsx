import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { useLocale } from './context/LocaleContext.jsx';

const Login = lazy(() => import('./pages/Login.jsx'));
const Register = lazy(() => import('./pages/Register.jsx'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const ClassDetail = lazy(() => import('./pages/ClassDetail.jsx'));
const Subscription = lazy(() => import('./pages/Subscription.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const AdminLogin = lazy(() => import('./pages/AdminLogin.jsx'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'));
const ChatWidget = lazy(() => import('./components/ChatWidget.jsx'));
const OnboardingTutorial = lazy(() => import('./components/OnboardingTutorial.jsx'));
const PublicAnnouncement = lazy(() => import('./components/PublicAnnouncement.jsx'));

function LoadingScreen() {
  const { t } = useLocale();
  return <div className="p-10 text-center text-ink/60">{t('appLoading')}</div>;
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
  );
}
