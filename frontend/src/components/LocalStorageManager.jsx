import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { formatBytes, getTeacherLocalStats } from '../utils/localCache.js';
import { clearTeacherDatabase, getLocalStats } from '../utils/localDb.js';
import { getLastSync, getSyncIntervalLabel, getSyncSettings, saveSyncSettings, syncSnapshot } from '../utils/snapshotSync.js';

export default function LocalStorageManager() {
  const { teacher, clearLocalCache } = useAuth();
  const [stats, setStats] = useState({ entries: 0, bytes: 0, snapshot: false, cacheEntries: 0, queued: 0 });
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
    setMessage(`تم ضبط المزامنة: ${getSyncIntervalLabel(next.frequency)}`);
    setTimeout(() => setMessage(''), 2500);
  };

  const syncNow = async () => {
    if (!teacher?.id) return;
    setSyncing(true);
    await syncSnapshot(teacher.id, { force: true });
    await refreshStats();
    setSyncing(false);
    setMessage('تمت مزامنة بيانات المعلم عند الطلب');
    setTimeout(() => setMessage(''), 2500);
  };

  const clearCache = async () => {
    if (!confirm('سيتم حذف النسخ المحلية المحفوظة على هذا الجهاز فقط، ولن تُحذف بياناتك من الخادم. هل تريد المتابعة؟')) return;
    await clearLocalCache();
    await clearTeacherDatabase(teacher?.id);
    await refreshStats();
    setMessage('تم حذف النسخ المحلية وطابور المزامنة من هذا الجهاز');
    setTimeout(() => setMessage(''), 3000);
  };

  return <div className="card p-5 mt-4"><h3 className="font-bold text-lg mb-1">بيانات الجهاز المحلية</h3><p className="text-xs text-ink/60 mb-3">يحتفظ التطبيق بنسخة محلية من بيانات المعلم والصفوف والطلاب والدرجات والسلوك والحضور والتقارير. تظهر البيانات فورًا من الجهاز ثم تُحدّث في الخلفية.</p><div className="flex flex-wrap items-center gap-3 text-sm"><span className="text-ink/60">{stats.snapshot ? 'snapshot محفوظ' : 'لا يوجد snapshot بعد'} — {stats.cacheEntries} كاش، {stats.queued} عمليات معلقة</span><button className="btn-primary text-xs" type="button" onClick={syncNow} disabled={syncing}>{syncing ? 'جارِ المزامنة...' : 'مزامنة الآن'}</button><button className="btn-secondary text-xs" type="button" onClick={clearCache}>مسح بيانات الجهاز</button></div><div className="flex flex-wrap items-center gap-3 text-sm mt-3 pt-3 border-t border-line"><label className="text-ink/60">المزامنة التلقائية:</label><select className="input text-xs w-36" value={settings.frequency} onChange={changeSettings}><option value="manual">عند الطلب</option><option value="daily">يوميًا</option><option value="weekly">أسبوعيًا</option><option value="monthly">شهريًا</option></select><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={settings.enabled} onChange={async (event) => { const next = await saveSyncSettings({ ...settings, enabled: event.target.checked }); setSettings(next); }} /> مفعّلة</label>{lastSync > 0 && <span className="text-xs text-ink/40">آخر مزامنة: {new Date(lastSync).toLocaleString('ar')}</span>}</div>{message && <p className="text-primary text-sm mt-3">{message}</p>}</div>;
}
