import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import { APP_NAME } from '../constants.js';
import PublicAnnouncement from '../components/PublicAnnouncement.jsx';
import PwaInstallButton from '../components/PwaInstallButton.jsx';
import Icon from '../components/Icon.jsx';

const ANDROID_APK_URL = import.meta.env.VITE_ANDROID_APK_URL || 'https://github.com/mohammedalimaaroufi-commits/educore2/releases/download/educore-android-latest/EduCore.apk';

export default function Login() {
  const { login } = useAuth();
  const { t, locale, changeLocale } = useLocale();
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
      setError(err.response?.data?.error || (locale === 'ar' ? 'تعذر تسجيل الدخول' : 'Unable to sign in'));
    } finally {
      setBusy(false);
    }
  };

  const ar = locale === 'ar';
  return (
    <div className="auth-shell" dir={ar ? 'rtl' : 'ltr'}>
      <div className="auth-decoration auth-decoration--one" /><div className="auth-decoration auth-decoration--two" />
      <PublicAnnouncement placement="public" />
      <div className="auth-layout">
        <section className="auth-intro">
          <div className="brand-lockup"><div className="brand-mark brand-mark--image"><img src="/educore-logo.webp" alt="EduCore" /></div><div><div className="brand-title">{APP_NAME}</div><div className="brand-subtitle">{ar ? 'إدارة الفصل الذكي' : 'Smart classroom management'}</div></div></div>
          <span className="eyebrow">{ar ? 'مساحتك التعليمية الهادئة' : 'Your calm teaching workspace'}</span>
          <h1>{ar ? <>نظّم صفوفك،<br /><em>وتابع أثر تعلمك.</em></> : <>Organize your classes,<br /><em>follow learning impact.</em></>}</h1>
          <p>{ar ? 'لوحة خفيفة وسريعة للمعلمين، تحفظ عملك محليًا وتبقيك مستعدًا حتى عند انقطاع الاتصال.' : 'A lightweight teacher workspace that saves locally and keeps you ready when connectivity drops.'}</p>
          <div className="auth-feature-list"><div><span>01</span><strong>{ar ? 'إدارة بسيطة' : 'Simple management'}</strong><small>{ar ? 'طلاب ودرجات وحضور في مكان واحد.' : 'Students, grades, and attendance in one place.'}</small></div><div><span>02</span><strong>{ar ? 'بياناتك لك' : 'Your data stays yours'}</strong><small>{ar ? 'حفظ محلي ومزامنة مرنة عند الحاجة.' : 'Local-first storage with flexible sync.'}</small></div></div>
          <div className="auth-platforms"><div className="auth-platforms__heading"><strong>{ar ? 'منصات EduCore' : 'EduCore platforms'}</strong><small>{ar ? 'النسخة الأحدث من Web متاحة الآن، وتطبيقات الهاتف في الطريق.' : 'The latest Web version is available now; mobile apps are on the way.'}</small></div><div className="auth-platforms__grid"><div className="auth-platform-card auth-platform-card--large is-live"><a href={window.location.origin} aria-label={ar ? 'فتح نسخة الويب' : 'Open web version'}><span className="auth-platform-card__icon"><Icon name="web" className="w-6 h-6" /></span><strong>Web / PWA</strong><small>{ar ? 'متاح الآن · فتح المنصة' : 'Available now · Open platform'}</small><span className="auth-platform-card__action">↗</span></a><PwaInstallButton compact /></div><a className="auth-platform-card auth-platform-card--large is-live" href={ANDROID_APK_URL} download aria-label={ar ? 'تحميل تطبيق Android' : 'Download Android app'}><span className="auth-platform-card__icon"><Icon name="android" className="w-6 h-6" /></span><strong>Android APK</strong><small>{ar ? 'تحميل النسخة' : 'Download APK'}</small><span className="auth-platform-card__action">↓</span></a><div className="auth-platform-card auth-platform-card--large is-future" aria-label={ar ? 'تطبيق iOS خطة مستقبلية' : 'iOS future plan'}><span className="auth-platform-card__icon auth-platform-card__icon--apple"></span><strong>iOS</strong><small>{ar ? 'خطة مستقبلية' : 'Future plan'}</small><span className="auth-platform-card__action">·</span></div></div></div>
        </section>
        <section className="auth-panel">
          <div className="auth-panel__heading"><div className="flex items-start justify-between gap-3"><div><span className="eyebrow">{ar ? 'مرحبًا بعودتك' : 'Welcome back'}</span><h2>{ar ? 'تسجيل الدخول' : 'Sign in'}</h2></div><select className="input w-28 text-xs" value={locale} onChange={(e) => void changeLocale(e.target.value)} aria-label={t('languageChoice')}><option value="ar">العربية</option><option value="en">English</option></select></div><p>{ar ? 'أدخل بياناتك للعودة إلى لوحة صفوفك.' : 'Enter your details to return to your classes.'}</p></div>
          <form onSubmit={submit} className="auth-form">
            <div><label className="label" htmlFor="login-email"><Icon name="user" className="w-3.5 h-3.5" /> {t('email')}</label><div className="auth-input-wrap"><Icon name="user" className="auth-input-icon" /><input id="login-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div></div>
            <div><label className="label" htmlFor="login-password"><Icon name="lock" className="w-3.5 h-3.5" /> {t('password')}</label><div className="auth-input-wrap"><Icon name="lock" className="auth-input-icon" /><input id="login-password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></div></div>
            {error && <p className="auth-error">{error}</p>}
            <div className="auth-form__meta"><span>{ar ? 'دخول آمن للمعلم' : 'Secure teacher access'}</span><Link to="/forgot-password">{ar ? 'نسيت كلمة المرور؟' : 'Forgot password?'}</Link></div>
            <button className="btn-primary auth-submit" disabled={busy}>{busy ? t('appLoading') : t('login')}<span>{ar ? '←' : '→'}</span></button>
          </form>
          <div className="auth-divider"><span>{ar ? 'أو' : 'OR'}</span></div>
          <div className="auth-socials"><button className="btn-secondary" type="button" disabled><Icon name="web" className="w-4 h-4" /> Google <span>{ar ? 'قريبًا' : 'Soon'}</span></button><button className="btn-secondary" type="button" disabled><span aria-hidden="true"></span> Apple ID <span>{ar ? 'قريبًا' : 'Soon'}</span></button></div>
          <p className="auth-register">{ar ? 'ليس لديك حساب؟' : 'Do not have an account?'} <Link to="/register">{ar ? 'أنشئ حسابًا مجانًا' : 'Create a free account'}</Link></p>
        </section>
      </div>
    </div>
  );
}
