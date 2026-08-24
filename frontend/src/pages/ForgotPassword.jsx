import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useLocale } from '../context/LocaleContext.jsx';
import { localizeApiError } from '../utils/apiError.js';

export default function ForgotPassword() {
  const { t, locale } = useLocale();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setResult(data);
    } catch (err) {
      setError(localizeApiError(err, t, locale, 'forgotPasswordError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-bold text-primary mb-1">{t('appName')}</h1>
        <p className="text-ink/60 mb-2">{t('forgotTitle')}</p>
        <p className="text-xs text-ink/50 mb-6">{t('forgotDescription')}</p>

        {result ? (
          <div className="space-y-4">
            <p className="text-sm text-ink/80 bg-primary/10 border border-primary/20 rounded-lg p-3">{t('forgotSubmitted')}</p>
            <p className="text-xs text-ink/50">{t('forgotPrivacy')}</p>
            <Link to="/login" className="btn-secondary w-full block text-center">{t('backToLogin')}</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div><label className="label">{t('email')}</label><input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus /></div>
            {error && <p className="text-danger text-sm">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>{busy ? '...' : t('sendResetRequest')}</button>
            <p className="text-center text-sm text-ink/60">{t('rememberedPassword')} <Link to="/login" className="text-primary font-medium">{t('login')}</Link></p>
          </form>
        )}
      </div>
    </div>
  );
}
