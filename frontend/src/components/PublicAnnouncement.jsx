import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { useLocale } from '../context/LocaleContext.jsx';

function readDismissed(key) {
  try { return localStorage.getItem(`educore_announcement_dismissed_${key}`) === '1'; } catch { return false; }
}

export default function PublicAnnouncement({ placement = 'global' }) {
  const { locale } = useLocale();
  const [announcement, setAnnouncement] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    api.get('/auth/public-config').then(({ data }) => {
      if (active) setAnnouncement(data.announcement || null);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const content = useMemo(() => {
    if (!announcement) return null;
    const title = locale === 'ar' ? announcement.title_ar : announcement.title_en;
    const message = locale === 'ar' ? announcement.message_ar : announcement.message_en;
    const ctaLabel = locale === 'ar' ? announcement.cta_label_ar : announcement.cta_label_en;
    const fallbackTitle = locale === 'ar' ? announcement.title_ar || announcement.title_en : announcement.title_en || announcement.title_ar;
    const fallbackMessage = locale === 'ar' ? announcement.message_ar || announcement.message_en : announcement.message_en || announcement.message_ar;
    const key = [announcement.type, announcement.starts_at, announcement.ends_at, fallbackTitle, fallbackMessage].join('|');
    return { ...announcement, title: title || fallbackTitle, message: message || fallbackMessage, ctaLabel, key };
  }, [announcement, locale]);

  useEffect(() => {
    if (content) setDismissed(readDismissed(content.key));
  }, [content]);

  if (!content || dismissed || !content.title && !content.message) return null;
  const isMaintenance = content.type === 'maintenance';
  const isUrgent = content.type === 'urgent';
  const direction = locale === 'ar' ? 'rtl' : 'ltr';
  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(`educore_announcement_dismissed_${content.key}`, '1'); } catch { /* local storage may be unavailable */ }
  };

  return (
    <aside className={`public-announcement public-announcement--${isUrgent ? 'urgent' : isMaintenance ? 'maintenance' : 'info'} public-announcement--${placement}`} dir={direction} role={isUrgent ? 'alert' : 'status'}>
      <div className="public-announcement__icon" aria-hidden="true">{isUrgent ? '!' : isMaintenance ? '◷' : 'i'}</div>
      <div className="public-announcement__body"><strong>{content.title}</strong>{content.message && <p>{content.message}</p>}{content.ctaLabel && content.cta_url && <a href={content.cta_url}>{content.ctaLabel}</a>}</div>
      <button type="button" className="public-announcement__close" onClick={dismiss} aria-label={locale === 'ar' ? 'إغلاق الإعلان' : 'Dismiss announcement'}>×</button>
    </aside>
  );
}
