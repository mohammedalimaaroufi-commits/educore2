import { useEffect, useMemo, useState } from 'react';
import { getPublicConfigState, subscribePublicConfig } from '../utils/publicConfigStore.js';
import { useLocale } from '../context/LocaleContext.jsx';
import Icon from './Icon.jsx';

const DISMISSED_PREFIX = 'educore_announcement_dismissed_';
const READ_PREFIX = 'educore_notification_read_';

function storageFlag(key, prefix) {
  try { return localStorage.getItem(`${prefix}${key}`) === '1'; } catch { return false; }
}

function saveStorageFlag(key, prefix) {
  try { localStorage.setItem(`${prefix}${key}`, '1'); } catch { /* storage may be unavailable */ }
}

function contentFor(item, locale, fallbackPrefix, t) {
  if (!item) return null;
  const title = locale === 'ar' ? item.title_ar || item.title_en : item.title_en || item.title_ar;
  const message = locale === 'ar' ? item.message_ar || item.message_en : item.message_en || item.message_ar;
  if (!title && !message) return null;
  const key = item.id || [fallbackPrefix, item.type, item.starts_at, item.ends_at, title, message].join('|');
  return {
    ...item,
    key,
    title: title || t('notification'),
    message: message || '',
    ctaLabel: locale === 'ar' ? item.cta_label_ar || item.cta_label_en : item.cta_label_en || item.cta_label_ar,
  };
}

export default function NotificationBell() {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [publicConfig, setPublicConfig] = useState(() => getPublicConfigState());
  const [dismissed, setDismissed] = useState({});
  const [read, setRead] = useState({});

  useEffect(() => subscribePublicConfig(setPublicConfig), []);

  useEffect(() => {
    const event = publicConfig.lastEvent;
    if (!event || event.announcement === false) return;
    setDismissed((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith('bell-announcement'))));
    setRead((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith('bell-announcement'))));
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith(`${DISMISSED_PREFIX}bell-announcement`) || key.startsWith(`${READ_PREFIX}bell-announcement`))
        .forEach((key) => localStorage.removeItem(key));
    } catch { /* storage may be unavailable */ }
  }, [publicConfig.revision]);

  const contents = useMemo(() => [
    contentFor(publicConfig.announcement, locale, 'bell-announcement', t),
    ...(publicConfig.notifications || []).map((item) => contentFor(item, locale, 'bell-notification', t)),
  ].filter(Boolean), [publicConfig.announcement, publicConfig.notifications, locale, t]);

  const visible = contents.filter((item) => !dismissed[item.key] && !storageFlag(item.key, DISMISSED_PREFIX));
  const unreadCount = visible.filter((item) => !read[item.key] && !storageFlag(item.key, READ_PREFIX)).length;

  const markAllRead = () => {
    const next = { ...read };
    visible.forEach((item) => {
      next[item.key] = true;
      saveStorageFlag(item.key, READ_PREFIX);
    });
    setRead(next);
  };

  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      if (next) markAllRead();
      return next;
    });
  };

  const dismiss = (key) => {
    setDismissed((current) => ({ ...current, [key]: true }));
    saveStorageFlag(key, DISMISSED_PREFIX);
  };

  return (
    <div className="notification-bell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <button type="button" className={`notification-bell__trigger ${open ? 'is-open' : ''}`} onClick={toggle} aria-label={t('openNotifications')} aria-expanded={open}>
        <Icon name="bell" className="w-4 h-4" />
        {unreadCount > 0 && <span className="notification-bell__count" aria-label={t('unreadNotifications', '', { count: unreadCount })}>{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && <div className="notification-bell__panel" role="dialog" aria-label={t('notificationCenter')}>
        <div className="notification-bell__heading"><div><span>{t('notificationCenter')}</span><strong>{t('alertsAndNotifications')}</strong></div><button type="button" onClick={() => setOpen(false)} aria-label={t('close')}>×</button></div>
        {visible.length === 0 ? <p className="notification-bell__empty">{t('noNewNotifications')}</p> : <div className="notification-bell__list">
          {visible.map((item) => {
            const urgent = item.type === 'urgent';
            const maintenance = item.type === 'maintenance';
            return <article key={item.key} className={`notification-bell__item notification-bell__item--${urgent ? 'urgent' : maintenance ? 'maintenance' : 'info'}`}>
              <span className="notification-bell__item-icon" aria-hidden="true">{urgent ? '!' : maintenance ? '◷' : 'i'}</span>
              <div className="notification-bell__item-body"><strong>{item.title}</strong>{item.message && <p>{item.message}</p>}{item.ctaLabel && item.cta_url && <a href={item.cta_url} target="_blank" rel="noreferrer">{item.ctaLabel}</a>}</div>
              <button type="button" className="notification-bell__item-close" onClick={() => dismiss(item.key)} aria-label={t('dismissNotification')}>×</button>
            </article>;
          })}
        </div>}
      </div>}
    </div>
  );
}
