import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: '', email: '', password: '', subject: '', school_stage: '', school_name: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(form);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'تعذر إنشاء الحساب');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="card w-full max-w-lg p-8">
        <h1 className="text-2xl font-bold text-primary mb-1">إنشاء حساب معلم</h1>
        <p className="text-ink/60 mb-6">تجربة مجانية كاملة لمدة 14 يومًا، بدون بطاقة ائتمان.</p>

        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label">الاسم الكامل</label>
            <input className="input" value={form.full_name} onChange={update('full_name')} required />
          </div>
          <div className="sm:col-span-2">
            <label className="label">البريد الإلكتروني</label>
            <input className="input" type="email" value={form.email} onChange={update('email')} required />
          </div>
          <div className="sm:col-span-2">
            <label className="label">كلمة المرور</label>
            <input className="input" type="password" value={form.password} onChange={update('password')} required minLength={6} />
          </div>
          <div>
            <label className="label">المادة الدراسية</label>
            <input className="input" value={form.subject} onChange={update('subject')} placeholder="مثال: رياضيات" />
          </div>
          <div>
            <label className="label">المرحلة الدراسية</label>
            <input className="input" value={form.school_stage} onChange={update('school_stage')} placeholder="مثال: متوسط" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">اسم المدرسة / المؤسسة</label>
            <input className="input" value={form.school_name} onChange={update('school_name')} />
          </div>

          {error && <p className="text-danger text-sm sm:col-span-2">{error}</p>}
          <button className="btn-primary sm:col-span-2" disabled={busy}>{busy ? '...' : 'ابدأ التجربة المجانية'}</button>
        </form>

        <p className="text-center text-sm text-ink/60 mt-6">
          لديك حساب بالفعل؟ <Link to="/login" className="text-primary font-medium">تسجيل الدخول</Link>
        </p>
      </div>
    </div>
  );
}
