import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import adminApi from '../api/adminClient';

export default function AdminLogin() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await adminApi.post('/admin/login', { password });
      localStorage.setItem('educore_admin_token', data.token);
      navigate('/admin');
    } catch (err) {
      setError(err.response?.data?.error || 'تعذر الدخول');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-ink">
      <div className="card w-full max-w-sm p-8">
        <h1 className="text-xl font-bold mb-1">لوحة تحكم المسؤول</h1>
        <p className="text-ink/60 text-sm mb-6">وصول خاص لمالك التطبيق فقط</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">كلمة المرور</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </div>
          {error && <p className="text-danger text-sm">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? '...' : 'دخول'}</button>
        </form>
      </div>
    </div>
  );
}
