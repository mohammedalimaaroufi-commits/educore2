import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import { localizeApiError } from '../utils/apiError.js';

export default function Register() {
  const { register } = useAuth();
  const { t, locale, changeLocale } = useLocale();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: '', email: '', password: '', confirm_password: '', subject: '', school_stage: '', school_name: '', locale });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const updateLocale = async (event) => {
    const next = event.target.value;
    setForm((current) => ({ ...current, locale: next }));
    await changeLocale(next);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!form.full_name.trim() || !form.email.trim() || !form.password) {
      setError(t('requiredFields'));
      return;
    }
    if (form.password !== form.confirm_password) {
      setError(t('passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      const { confirm_password, ...payload } = form;
      await register(payload);
      navigate('/');
    } catch (err) {
      setError(localizeApiError(err, t, locale, 'requiredFields'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="register-shell">
      <div className="register-aside">
        <span className="register-brand">{t('appName')}</span>
        <div className="register-aside__orb" />
        <p className="register-aside__eyebrow">{t('registerStep')}</p>
        <h1>{t('registerTitle')}</h1>
        <p>{t('registerSubtitle')}</p>
        <div className="register-benefits"><span>✓ {t('students')}</span><span>✓ {t('gradebook')}</span><span>✓ {t('analytics')}</span><span>✓ {t('offline').split('.')[0]}</span></div>
      </div>
      <div className="register-card">
        <div className="register-card__top"><div><span className="settings-eyebrow">{t('appName')}</span><h2>{t('registerTitle')}</h2></div><label className="register-language"><span>{t('languageChoice')}</span><select className="input" value={form.locale} onChange={updateLocale}><option value="ar">{t('arabicLanguageName')}</option><option value="en">English</option></select></label></div>
        <div className="register-progress"><span className="is-active">1</span><i /><span className="is-active">2</span><i /><span>3</span><small>{t('registerStep')} · {t('registerSchool')} · EduCore</small></div>
        <form onSubmit={submit} className="register-form">
          <div className="register-section-title"><strong>01</strong><div><h3>{t('registerStep')}</h3><p>{t('email')} · {t('password')}</p></div></div>
          <label className="label">{t('fullName')}<input className="input" value={form.full_name} onChange={update('full_name')} required autoComplete="name" /></label>
          <label className="label">{t('email')}<input className="input" type="email" value={form.email} onChange={update('email')} required autoComplete="email" /></label>
          <div className="register-form-grid"><label className="label">{t('password')}<input className="input" type="password" value={form.password} onChange={update('password')} required minLength={6} autoComplete="new-password" /></label><label className="label">{t('confirmPassword')}<input className="input" type="password" value={form.confirm_password} onChange={update('confirm_password')} required minLength={6} autoComplete="new-password" /></label></div>
          <div className="register-section-title"><strong>02</strong><div><h3>{t('registerSchool')}</h3><p>{t('school')} · {t('subject')}</p></div></div>
          <div className="register-form-grid"><label className="label">{t('subject')}<input className="input" value={form.subject} onChange={update('subject')} placeholder={t('subjectPlaceholder')} /></label><label className="label">{t('schoolStage')}<input className="input" value={form.school_stage} onChange={update('school_stage')} placeholder={t('schoolStagePlaceholder')} /></label></div>
          <label className="label">{t('school')}<input className="input" value={form.school_name} onChange={update('school_name')} /></label>
          {error && <p className="register-error" role="alert">{error}</p>}
          <button className="btn-primary register-submit" disabled={busy}>{busy ? t('appLoading') : t('startTrial')} <span>→</span></button>
        </form>
        <p className="register-login">{t('haveAccount')} <Link to="/login" className="text-primary font-bold">{t('login')}</Link></p>
      </div>
    </div>
  );
}
