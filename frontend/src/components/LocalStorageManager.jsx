import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { formatBytes, getTeacherLocalStats } from '../utils/localCache.js';
import { clearTeacherDatabase, getLocalStats } from '../utils/localDb.js';
import { getLastSync, getSyncIntervalLabel, getSyncSettings, saveSyncSettings, syncTeacherData } from '../utils/snapshotSync.js';
import { useLocale } from '../context/LocaleContext.jsx';
import { useConfirmDialog } from './ConfirmDialog.jsx';

export default function LocalStorageManager() {
  const { teacher, clearLocalCache } = useAuth();
  const { t, locale } = useLocale();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [stats, setStats] = useState({ entries: 0, bytes: 0, snapshot: false, cacheEntries: 0, queued: 0, blocked: 0 });
  const [message, setMessage] = useState('');
  const [settings, setSettings] = useState({ enabled: true, frequency: 'daily' });
  const [lastSync, setLastSync] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshStats = async () => {
    if (!teacher?.id) return;
    const [legacy, local, currentSettings, last] = await Promise.all([
      Promise.resolve(getTeacherLocalStats(teacher.id)),
      getLocalStats(teacher.id),
      getSyncSettings(),
      getLastSync(teacher.id),
    ]);
    setStats({ ...legacy, ...local });
    setSettings(currentSettings);
    setLastSync(last);
  };

  useEffect(() => { void refreshStats(); }, [teacher?.id]);

  const changeSettings = async (event) => {
    const next = await saveSyncSettings({ ...settings, frequency: event.target.value });
    setSettings(next);
    setMessage(t('syncConfigured', '', { frequency: getSyncIntervalLabel(next.frequency, locale, t) }));
    setTimeout(() => setMessage(''), 2500);
  };

  const syncNow = async () => {
    if (!teacher?.id) return;
    setSyncing(true);
    try {
      const result = await syncTeacherData(teacher.id);
      await refreshStats();
      if (!result.successful) setMessage(t('syncFailed'));
      else if (result.blocked > 0) setMessage(t('syncCompletedWithBlocked', '', { count: result.blocked }));
      else if (result.rejected > 0) setMessage(t('syncCompletedWithRejected', '', { count: result.rejected }));
      else setMessage(t('teacherDataSynced'));
    } catch {
      setMessage(t('syncFailed'));
    } finally {
      setSyncing(false);
      setTimeout(() => setMessage(''), 2500);
    }
  };

  const clearCache = async () => {
    const accepted = await confirm({ title: t('clearDeviceTitle'), message: t('clearDeviceMessage'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true });
    if (!accepted) return;
    await clearLocalCache();
    await clearTeacherDatabase(teacher?.id);
    await refreshStats();
    setMessage(t('deviceDataCleared'));
    setTimeout(() => setMessage(''), 3000);
  };

  return <div className="card p-5 mt-4">{confirmDialog}<h3 className="font-bold text-lg mb-1">{t('localDeviceData')}</h3><p className="text-xs text-ink/60 mb-3">{t('localDataDescription')}</p><div className="flex flex-wrap items-center gap-3 text-sm"><span className="text-ink/60">{stats.snapshot ? t('snapshotSaved') : t('noSnapshot')} — {t('cacheCount', '', { count: stats.cacheEntries })}{t('analyticsListSeparator')}{t('queuedOperations', '', { count: stats.queued })}{stats.blocked > 0 && <>{t('analyticsListSeparator')}{t('blockedOperations', '', { count: stats.blocked })}</>} · {formatBytes(stats.bytes, locale, t)}</span><button className="btn-primary text-xs" type="button" onClick={syncNow} disabled={syncing}>{syncing ? t('syncing') : t('syncNow')}</button><button className="btn-secondary text-xs" type="button" onClick={clearCache}>{t('clearDeviceData')}</button></div><div className="flex flex-wrap items-center gap-3 text-sm mt-3 pt-3 border-t border-line"><label className="text-ink/60">{t('autoSync')}:</label><select className="input text-xs w-36" value={settings.frequency} onChange={changeSettings}><option value="manual">{t('manual')}</option><option value="daily">{t('daily')}</option><option value="weekly">{t('weekly')}</option><option value="monthly">{t('monthly')}</option></select><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={settings.enabled} onChange={async (event) => { const next = await saveSyncSettings({ ...settings, enabled: event.target.checked }); setSettings(next); }} /> {t('enabled')}</label>{lastSync > 0 && <span className="text-xs text-ink/40">{t('lastSync')}: {new Date(lastSync).toLocaleString(locale === 'ar' ? 'ar' : 'en-US')}</span>}</div>{message && <p className="text-primary text-sm mt-3">{message}</p>}</div>;
}
