import React, { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Eye, EyeOff, LockKeyhole, Mail, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { APP_NAME } from '../constants.js';

const highlights = [
  'نظّم الحضور والدرجات في مكان واحد',
  'تابع تقدم طلابك بوضوح وسرعة',
  'ابدأ مجانًا بدون بطاقة ائتمان',
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'تعذر تسجيل الدخول. تحقق من بياناتك وحاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page" dir="rtl">
      <div className="auth-shell">
        <section className="auth-intro" aria-labelledby="auth-title">
          <div className="auth-brand">
            <span className="auth-brand-mark" aria-hidden="true"><Sparkles size={20} strokeWidth={2.5} /></span>
            <span>{APP_NAME}</span>
          </div>
          <div className="auth-intro-copy">
            <p className="auth-eyebrow">مساحتك التعليمية الذكية</p>
            <h1 id="auth-title">كل فصل دراسي،<br /><span>بشكل أبسط.</span></h1>
            <p className="auth-intro-description">أدِر فصلك بثقة، وامنح وقتك لما يستحقه فعلًا: تعليم طلابك.</p>
            <ul className="auth-highlights" aria-label="مزايا المنصة">
              {highlights.map((highlight) => (
                <li key={highlight}><span aria-hidden="true"><Check size={15} strokeWidth={3} /></span>{highlight}</li>
              ))}
            </ul>
          </div>
          <p className="auth-footer-note">مصمم للمعلمين، من أجل تعليم أكثر أثرًا.</p>
        </section>

        <section className="auth-card-wrap" aria-label="تسجيل الدخول">
          <div className="auth-card">
            <div className="auth-card-header">
              <div className="auth-mobile-brand auth-brand">
                <span className="auth-brand-mark" aria-hidden="true"><Sparkles size={18} strokeWidth={2.5} /></span>
                <span>{APP_NAME}</span>
              </div>
              <p className="auth-card-kicker">مرحبًا بعودتك</p>
              <h2>تسجيل الدخول</h2>
              <p>أدخل بياناتك للوصول إلى لوحة التحكم.</p>
            </div>

            <form onSubmit={submit} className="auth-form" noValidate>
              <div className="auth-field">
                <label htmlFor={emailId}>البريد الإلكتروني</label>
                <div className="auth-input-wrap">
                  <Mail size={18} aria-hidden="true" />
                  <input
                    id={emailId}
                    className="auth-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@school.com"
                    autoComplete="email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck="false"
                    required
                  />
                </div>
              </div>

              <div className="auth-field">
                <div className="auth-label-row">
                  <label htmlFor={passwordId}>كلمة المرور</label>
                  <Link to="/forgot-password" className="auth-link auth-forgot">نسيت كلمة المرور؟</Link>
                </div>
                <div className="auth-input-wrap">
                  <LockKeyhole size={18} aria-hidden="true" />
                  <input
                    id={passwordId}
                    className="auth-input auth-password-input"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="أدخل كلمة المرور"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="auth-icon-button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {error && <p className="auth-error" role="alert">{error}</p>}

              <button className="auth-submit" disabled={busy} type="submit">
                {busy ? <><span className="auth-spinner" aria-hidden="true" /> جارٍ تسجيل الدخول...</> : <>تسجيل الدخول <ArrowLeft size={18} aria-hidden="true" /></>}
              </button>
            </form>

            <div className="auth-divider"><span>أو</span></div>
            <p className="auth-signup">ليس لديك حساب؟ <Link to="/register" className="auth-link">أنشئ حسابًا مجانًا</Link></p>
          </div>
          <p className="auth-legal">بتسجيل الدخول، أنت توافق على شروط الاستخدام وسياسة الخصوصية.</p>
        </section>
      </div>
    </main>
  );
}
