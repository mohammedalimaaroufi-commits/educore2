import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../context/LocaleContext.jsx';

export default function TrialBanner() {
  const { subscription, subscriptionInfo, trialInfo } = useAuth();
  const { t } = useLocale();
  // A paid server presentation is authoritative during reconciliation; never
  // show a stale trial countdown above an already activated paid package.
  const effectivePlan = subscriptionInfo?.plan || subscription?.plan;
  if (!subscription || effectivePlan !== 'trial' || !trialInfo) return null;

  const { daysLeft, alertLevel } = trialInfo;
  if (alertLevel === 'none') return null; // only nudge on day 10 / 13 / 14 window

  const styles = {
    warning: 'bg-accent/15 border-accent text-ink',
    critical: 'bg-danger/10 border-danger text-danger',
  };

  return (
    <div className={`dashboard-trial-banner border rounded-xl2 px-4 py-3 mb-4 flex items-center justify-between ${styles[alertLevel]}`}>
      <span className="text-sm font-medium">
        {daysLeft > 0 ? (daysLeft === 1 ? t('trialRemainingDay') : t('trialRemainingDays', '', { count: daysLeft })) : t('trialExpired')}
      </span>
      <Link to="/subscription" className="btn-primary text-sm">{t('upgradeSubscription')}</Link>
    </div>
  );
}
