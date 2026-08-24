import React, { useEffect, useState } from 'react';
import { useLocale } from '../context/LocaleContext.jsx';

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export default function PwaInstallButton({ compact = false }) {
  const { t } = useLocale();
  const [promptEvent, setPromptEvent] = useState(null);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [showHelp, setShowHelp] = useState(false);

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

  if (installed) return <span className="pwa-install-status">{t('pwaInstalled')}</span>;

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
    <button type="button" className="pwa-install__button" onClick={() => void install()}>{t('pwaInstall')}<span>↥</span></button>
    {showHelp && <p className="pwa-install__help">{t('pwaInstallHelp')}</p>}
  </div>;
}
