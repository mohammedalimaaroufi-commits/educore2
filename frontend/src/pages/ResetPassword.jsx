import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { APP_NAME } from '../constants.js';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('كلمتا المرور غير متطابقتين'); return; }
    if (password.length < 6) { setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذر تحديث كلمة المرور');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-bold text-primary mb-1">{APP_NAME}</h1>
        <p className="text-ink/60 mb-6">تعيين كلمة مرور جديدة</p>

        {!token ? (
          <div className="space-y-3">
            <p className="text-danger text-sm">الرابط غير صالح. يرجى طلب رابط إعادة تعيين جديد.</p>
            <Link to="/forgot-password" className="btn-primary w-full block text-center">طلب رابط جديد</Link>
          </div>
        ) : done ? (
          <p className="text-primary text-sm bg-primary/10 border border-primary/20 rounded-lg p-3">
            تم تحديث كلمة المرور بنجاح. جارٍ تحويلك لتسجيل الدخول...
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">كلمة المرور الجديدة</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
            </div>
            <div>
              <label className="label">تأكيد كلمة المرور</label>
              <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            {error && <p className="text-danger text-sm">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>{busy ? '...' : 'تحديث كلمة المرور'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
