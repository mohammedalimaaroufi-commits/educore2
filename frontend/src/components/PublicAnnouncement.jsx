import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { connectSocket } from '../api/socket';
import { useLocale } from '../context/LocaleContext.jsx';

function readDismissed(key) {
  try { return localStorage.getItem(`educore_announcement_dismissed_${key}`) === '1'; } catch { return false; }
}

function buildContent(item, locale, fallbackPrefix = 'legacy') {
  if (!item) return null;
  const title = locale === 'ar' ? item.title_ar : item.title_en;
  const message = locale === 'ar' ? item.message_ar : item.message_en;
  const ctaLabel = locale === 'ar' ? item.cta_label_ar : item.cta_label_en;
  const fallbackTitle = locale === 'ar' ? item.title_ar || item.title_en : item.title_en || item.title_ar;
  const fallbackMessage = locale === 'ar' ? item.message_ar || item.message_en : item.message_en || item.message_ar;
  if (!fallbackTitle && !fallbackMessage) return null;
  const key = item.id || [fallbackPrefix, item.type, item.starts_at, item.ends_at, fallbackTitle, fallbackMessage].join('|');
  return { ...item, title: title || fallbackTitle, message: message || fallbackMessage, ctaLabel: ctaLabel || (locale === 'ar' ? item.cta_label_ar || item.cta_label_en : item.cta_label_en || item.cta_label_ar), key };
}

export default function PublicAnnouncement({ placement = 'global' }) {
  const { locale } = useLocale();
  const [announcement, setAnnouncement] = useState(null);
  const [dismissed, setDismissed] = useState({});

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const { data } = await api.get('/auth/public-config');
        if (active) setAnnouncement(data.announcement || null);
      } catch {
        // Keep the last visible announcement when the network is temporarily unavailable.
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30 * 1000);
    const onFocus = () => { void refresh(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    const socket = connectSocket(localStorage.getItem('educore_token') || '', { onReconnect: refresh });
    socket?.on('public_config_updated', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      socket?.disconnect();
    };
  }, []);

  const contents = useMemo(() => [buildContent(announcement, locale, 'legacy')].filter(Boolean), [announcement, locale]);

  const dismiss = (key) => {
    setDismissed((current) => ({ ...current, [key]: true }));
    try { localStorage.setItem(`educore_announcement_dismissed_${key}`, '1'); } catch { /* local storage may be unavailable */ }
  };

  const visible = contents.filter((content) => !dismissed[content.key] && !readDismissed(content.key));
  if (!visible.length) return null;
  const direction = locale === 'ar' ? 'rtl' : 'ltr';

  return <div className="public-announcement-stack" dir={direction}>
    {visible.map((content) => {
      const isMaintenance = content.type === 'maintenance';
      const isUrgent = content.type === 'urgent';
      return <aside key={content.key} className={`public-announcement public-announcement--${isUrgent ? 'urgent' : isMaintenance ? 'maintenance' : 'info'} public-announcement--${placement}`} role={isUrgent ? 'alert' : 'status'}>
        <div className="public-announcement__icon" aria-hidden="true">{isUrgent ? '!' : isMaintenance ? '◷' : 'i'}</div>
        <div className="public-announcement__body"><strong>{content.title}</strong>{content.message && <p>{content.message}</p>}{content.ctaLabel && content.cta_url && <a href={content.cta_url}>{content.ctaLabel}</a>}</div>
        <button type="button" className="public-announcement__close" onClick={() => dismiss(content.key)} aria-label={locale === 'ar' ? 'مسح الإشعار' : 'Dismiss notification'}>×</button>
      </aside>;
    })}
  </div>;
}
