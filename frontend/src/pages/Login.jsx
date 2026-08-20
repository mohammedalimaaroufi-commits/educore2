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
    <div className="auth-shell" dir="rtl">
      <div className="auth-decoration auth-decoration--one" />
      <div className="auth-decoration auth-decoration--two" />
      <div className="auth-layout">
        <section className="auth-intro">
          <div className="brand-lockup"><div className="brand-mark">س</div><div><div className="brand-title">{APP_NAME}</div><div className="brand-subtitle">إدارة الفصل الذكي</div></div></div>
          <span className="eyebrow">مساحتك التعليمية الهادئة</span>
          <h1>نظّم صفوفك،<br /><em>وتابع أثر تعلمك.</em></h1>
          <p>لوحة خفيفة وسريعة للمعلمين، تحفظ عملك محليًا وتبقيك مستعدًا حتى عند انقطاع الاتصال.</p>
          <div className="auth-feature-list"><div><span>01</span><strong>إدارة بسيطة</strong><small>طلاب ودرجات وحضور في مكان واحد.</small></div><div><span>02</span><strong>بياناتك لك</strong><small>حفظ محلي ومزامنة مرنة عند الحاجة.</small></div></div>
        </section>
        <section className="auth-panel">
          <div className="auth-panel__heading"><span className="eyebrow">مرحبًا بعودتك</span><h2>تسجيل الدخول</h2><p>أدخل بياناتك للعودة إلى لوحة صفوفك.</p></div>
          <form onSubmit={submit} className="auth-form">
            <div><label className="label">البريد الإلكتروني</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div>
            <div><label className="label">كلمة المرور</label><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></div>
            {error && <p className="auth-error">{error}</p>}
            <div className="auth-form__meta"><span>دخول آمن للمعلم</span><Link to="/forgot-password">نسيت كلمة المرور؟</Link></div>
            <button className="btn-primary auth-submit" disabled={busy}>{busy ? 'جارِ الدخول...' : 'تسجيل الدخول'}<span>←</span></button>
          </form>
          <div className="auth-divider"><span>أو</span></div>
          <div className="auth-socials"><button className="btn-secondary" type="button" disabled>Google <span>قريبًا</span></button><button className="btn-secondary" type="button" disabled>Apple ID <span>قريبًا</span></button></div>
          <p className="auth-register">ليس لديك حساب؟ <Link to="/register">أنشئ حسابًا مجانًا</Link></p>
        </section>
      </div>
    </div>
  );
}
