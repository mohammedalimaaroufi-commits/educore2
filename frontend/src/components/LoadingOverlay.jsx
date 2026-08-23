import React from 'react';
import { useLocale } from '../context/LocaleContext.jsx';

export default function LoadingOverlay({ label }) {
  const { t } = useLocale();
  const message = label || t('appLoading');

  return (
    <div className="loading-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="loading-overlay__dialog">
        <div className="loading-overlay__logo-stage" aria-hidden="true">
          <span className="loading-overlay__orbit loading-overlay__orbit--outer" />
          <span className="loading-overlay__orbit loading-overlay__orbit--middle" />
          <span className="loading-overlay__orbit loading-overlay__orbit--inner" />
          <img className="loading-overlay__logo" src="/educore-logo.webp" alt="" />
        </div>
        <div className="loading-overlay__copy">
          <strong>EduCore</strong>
          <span>{message}</span>
        </div>
      </div>
    </div>
  );
}
