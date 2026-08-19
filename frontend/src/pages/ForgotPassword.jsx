import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { APP_NAME } from '../constants.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { message, devMode, resetLink }

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذر إرسال طلب إعادة التعيين');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-bold text-primary mb-1">{APP_NAME}</h1>
        <p className="text-ink/60 mb-6">استعادة كلمة المرور</p>

        {result ? (
          <div className="space-y-4">
            <p className="text-sm text-ink/80 bg-primary/10 border border-primary/20 rounded-lg p-3">{result.message}</p>
            {result.devMode && result.resetLink && (
              <div className="text-sm bg-accent/10 border border-accent/30 rounded-lg p-3 space-y-2">
                <p className="text-ink/70">
                  لا يوجد خادم بريد مُعدّ حاليًا لهذا التطبيق، لذا إليك رابط إعادة التعيين مباشرة (في الاستخدام الفعلي سيصل هذا الرابط بالبريد الإلكتروني):
                </p>
                <Link to={result.resetLink.replace(window.location.origin, '')} className="text-primary font-medium break-all underline">
                  فتح رابط إعادة التعيين
                </Link>
              </div>
            )}
            <Link to="/login" className="btn-secondary w-full block text-center">العودة لتسجيل الدخول</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">البريد الإلكتروني</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            {error && <p className="text-danger text-sm">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>{busy ? '...' : 'إرسال رابط إعادة التعيين'}</button>
            <p className="text-center text-sm text-ink/60">
              تذكرت كلمة المرور؟ <Link to="/login" className="text-primary font-medium">تسجيل الدخول</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
