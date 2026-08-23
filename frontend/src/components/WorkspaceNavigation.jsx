import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import Icon from './Icon.jsx';
import { APP_NAME } from '../constants.js';

const NAV_ITEMS = [
  { href: '/', icon: 'dashboard', key: 'dashboard' },
  { href: '/subscription', icon: 'subscription', key: 'subscription' },
  { href: '/settings', icon: 'settings', key: 'settings' },
];

function isCurrentPath(pathname, href) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export default function WorkspaceNavigation() {
  const { pathname } = useLocation();
  const { teacher, logout } = useAuth();
  const { t, direction, locale } = useLocale();
  const initials = (teacher?.full_name || 'س').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const isArabic = locale === 'ar';

  return (
    <>
      <aside className="workspace-sidebar" dir={direction} aria-label={isArabic ? 'التنقل الرئيسي' : 'Main navigation'}>
        <div className="workspace-sidebar__brand">
          <div className="brand-mark brand-mark--image"><img src="/educore-logo.webp" alt="EduCore" /></div>
          <div className="workspace-sidebar__brand-copy"><strong>{APP_NAME}</strong><small>{isArabic ? 'مساحة عمل المعلم' : 'Teacher workspace'}</small></div>
        </div>
        <div className="workspace-sidebar__section-label">{isArabic ? 'مساحتك' : 'Your workspace'}</div>
        <nav className="workspace-sidebar__nav">
          {NAV_ITEMS.map((item) => {
            const active = isCurrentPath(pathname, item.href);
            return <Link key={item.href} to={item.href} className={`workspace-nav-item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
              <Icon name={item.icon} className="workspace-nav-item__icon" />
              <span>{t(item.key)}</span>
            </Link>;
          })}
        </nav>
        <div className="workspace-sidebar__footer">
          <div className="workspace-user-card">
            <span className="workspace-user-card__avatar">{initials}</span>
            <span className="workspace-user-card__copy"><strong>{teacher?.full_name || (isArabic ? 'المعلم' : 'Teacher')}</strong><small>{teacher?.email || ''}</small></span>
          </div>
          <button type="button" className="workspace-logout" onClick={logout}><Icon name="logout" className="w-4 h-4" /><span>{t('logout')}</span></button>
        </div>
      </aside>

      <nav className="workspace-mobile-nav" dir={direction} aria-label={isArabic ? 'التنقل السريع' : 'Quick navigation'}>
        {NAV_ITEMS.map((item) => {
          const active = isCurrentPath(pathname, item.href);
          return <Link key={item.href} to={item.href} className={`workspace-mobile-nav__item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
            <Icon name={item.icon} className="w-4 h-4" /><span>{t(item.key)}</span>
          </Link>;
        })}
        <button type="button" className="workspace-mobile-nav__item workspace-mobile-nav__item--danger" onClick={logout}><Icon name="logout" className="w-4 h-4" /><span>{t('logout')}</span></button>
      </nav>
    </>
  );
}
