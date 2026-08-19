import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';

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

function LoadingScreen() {
  return <div className="p-10 text-center text-ink/60">جارِ التحميل...</div>;
}

function OfflineBanner() {
  const { offline } = useAuth();
  if (!offline) return null;
  return (
    <div className="sticky top-0 z-50 bg-amber-100 text-amber-900 border-b border-amber-200 px-4 py-2 text-center text-xs">
      لا يوجد اتصال بالخادم حاليًا. تظهر النسخ المحفوظة على هذا الجهاز، وستتم محاولة المزامنة عند عودة الاتصال.
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { teacher, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!teacher) return <Navigate to="/login" replace />;
  return (
    <>
      <OfflineBanner />
      {children}
      <Suspense fallback={null}><ChatWidget /></Suspense>
    </>
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
