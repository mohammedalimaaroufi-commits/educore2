import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import PublicAnnouncement from '../components/PublicAnnouncement.jsx';
import PwaInstallButton from '../components/PwaInstallButton.jsx';
import Icon from '../components/Icon.jsx';
import { localizeApiError } from '../utils/apiError.js';

const ANDROID_APK_URL = import.meta.env.VITE_ANDROID_APK_URL || 'https://github.com/mohammedalimaaroufi-commits/educore2/releases/download/educore-android-latest/EduCore.apk';

export default function Login() {
  const { login } = useAuth();
  const { t, locale, changeLocale } = useLocale();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password, rememberMe);
      navigate('/');
    } catch (err) {
      setError(localizeApiError(err, t, locale, 'loginError'));
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
          <div className="brand-lockup"><div className="brand-mark brand-mark--image"><img src="/educore-logo.webp" alt="EduCore" /></div><div><div className="brand-title">{t('appName')}</div><div className="brand-subtitle">{t('appSubtitle')}</div></div></div>
          <span className="eyebrow">{t('loginHeroEyebrow')}</span>
          <h1>{t('loginHeroTitle')}<br /><em>{t('loginHeroTitleEm')}</em></h1>
          <p>{t('loginHeroDescription')}</p>
          <div className="auth-platforms auth-platforms--buttons"><div className="auth-platforms__heading"><strong>{t('loginPlatformsTitle')}</strong><small>{t('loginPlatformsDescription')}</small></div><div className="auth-platform-image-buttons"><a className="auth-platform-image-link" href={window.location.origin} aria-label={t('launchWebApp')}><img src="/pwa-launch-button.png" alt={t('launchWebAppAlt')} /></a><a className="auth-platform-image-link" href={ANDROID_APK_URL} download aria-label={t('downloadAndroidApp')}><img src="/android-apk-button.png" alt={t('downloadAndroidAlt')} /></a></div><div className="auth-pwa-install-row"><PwaInstallButton compact /></div></div>
        </section>
        <section className="auth-panel">
          <div className="auth-panel__heading"><div className="flex items-start justify-between gap-3"><div><span className="eyebrow">{t('welcomeBack')}</span><h2>{t('signInTitle')}</h2></div><select className="input w-28 text-xs" value={locale} onChange={(e) => void changeLocale(e.target.value)} aria-label={t('languageChoice')}><option value="ar">{t('arabicLanguageName')}</option><option value="en">English</option></select></div><p>{t('loginPanelDescription')}</p></div>
          <form onSubmit={submit} className="auth-form">
            <div><label className="label" htmlFor="login-email"><Icon name="user" className="w-3.5 h-3.5" /> {t('email')}</label><div className="auth-input-wrap"><Icon name="user" className="auth-input-icon" /><input id="login-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div></div>
            <div><label className="label" htmlFor="login-password"><Icon name="lock" className="w-3.5 h-3.5" /> {t('password')}</label><div className="auth-input-wrap"><Icon name="lock" className="auth-input-icon" /><input id="login-password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></div></div>
            {error && <p className="auth-error">{error}</p>}
            <div className="auth-form__meta"><label className="auth-remember"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /><span>{t('rememberMe')}</span></label><Link to="/forgot-password">{t('forgotPassword')}</Link></div>
            <button className="btn-primary auth-submit" disabled={busy}>{busy ? t('appLoading') : t('login')}<span>{ar ? '←' : '→'}</span></button>
          </form>
          <div className="auth-divider"><span>{t('or')}</span></div>
          <div className="auth-socials"><button className="btn-secondary" type="button" disabled><Icon name="web" className="w-4 h-4" /> Google <span>{t('comingSoon')}</span></button><button className="btn-secondary" type="button" disabled><span aria-hidden="true"></span> Apple ID <span>{t('comingSoon')}</span></button></div>
          <p className="auth-register">{t('noAccount')} <Link to="/register">{t('createFreeAccount')}</Link></p>
        </section>
      </div>
    </div>
  );
}
