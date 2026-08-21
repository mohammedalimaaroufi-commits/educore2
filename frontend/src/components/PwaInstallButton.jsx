import React, { useEffect, useState } from 'react';
import { useLocale } from '../context/LocaleContext.jsx';

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export default function PwaInstallButton({ compact = false }) {
  const { locale } = useLocale();
  const [promptEvent, setPromptEvent] = useState(null);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [showHelp, setShowHelp] = useState(false);
  const ar = locale === 'ar';

  useEffect(() => {
    const onBeforeInstall = (event) => {
      event.preventDefault();
      setPromptEvent(event);
    };
    const onInstalled = () => { setInstalled(true); setPromptEvent(null); };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return <span className="pwa-install-status">{ar ? 'مثبت كتطبيق' : 'Installed as an app'}</span>;

  const install = async () => {
    if (!promptEvent) {
      setShowHelp((current) => !current);
      return;
    }
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice?.outcome === 'accepted') setInstalled(true);
    setPromptEvent(null);
  };

  return <div className={`pwa-install ${compact ? 'pwa-install--compact' : ''}`}>
    <button type="button" className="pwa-install__button" onClick={() => void install()}>{ar ? 'تثبيت Web كتطبيق' : 'Install Web app'}<span>↥</span></button>
    {showHelp && <p className="pwa-install__help">{ar ? 'في Chrome اختر تثبيت التطبيق من قائمة المتصفح. في Safari على iPhone اختر مشاركة ثم إضافة إلى الشاشة الرئيسية.' : 'In Chrome choose Install app from the browser menu. On iPhone Safari choose Share, then Add to Home Screen.'}</p>}
  </div>;
}
