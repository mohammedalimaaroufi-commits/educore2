import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { APP_NAME } from '../constants.js';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'تعذر تسجيل الدخول');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-bold text-primary mb-1">{APP_NAME}</h1>
        <p className="text-ink/60 mb-6">مدير الفصل الدراسي الذكي للمعلمين</p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">البريد الإلكتروني</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label">كلمة المرور</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-danger text-sm">{error}</p>}
          <div className="flex justify-end -mt-1">
            <Link to="/forgot-password" className="text-xs text-primary hover:underline">نسيت كلمة المرور؟</Link>
          </div>
          <button className="btn-primary w-full" disabled={busy}>{busy ? '...' : 'تسجيل الدخول'}</button>
        </form>

        <div className="mt-4 flex gap-2">
          <button className="btn-secondary flex-1" type="button" disabled>Google (قريباً)</button>
          <button className="btn-secondary flex-1" type="button" disabled>Apple ID (قريباً)</button>
        </div>

        <p className="text-center text-sm text-ink/60 mt-6">
          ليس لديك حساب؟ <Link to="/register" className="text-primary font-medium">أنشئ حسابًا مجانًا</Link>
        </p>
      </div>
    </div>
  );
}
