import React, { useEffect, useState } from 'react';
import adminApi from '../api/adminClient';

const EMPTY_NOTIFICATION = { id: '', type: 'info', title_ar: '', title_en: '', message_ar: '', message_en: '', cta_url: '', starts_at: '', ends_at: '', enabled: true };

const DEFAULT_CONFIG = {
  payment_phone: '', payment_recipient: '', payment_method: '', payment_account: '', payment_note_ar: '', payment_note_en: '',
  announcement_enabled: '0', announcement_type: 'maintenance', announcement_title_ar: '', announcement_title_en: '',
  announcement_message_ar: '', announcement_message_en: '', announcement_cta_label_ar: '', announcement_cta_label_en: '', announcement_cta_url: '',
  announcement_starts_at: '', announcement_ends_at: '', announcement_notifications: [],
};

function localDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toPayload(config) {
  const isoOrEmpty = (value) => value ? new Date(value).toISOString() : '';
  return {
    ...config,
    announcement_enabled: config.announcement_enabled === true || config.announcement_enabled === '1' ? '1' : '0',
    announcement_starts_at: isoOrEmpty(config.announcement_starts_at),
    announcement_ends_at: isoOrEmpty(config.announcement_ends_at),
    announcement_notifications: (config.announcement_notifications || []).map((item) => ({ ...item, starts_at: isoOrEmpty(item.starts_at), ends_at: isoOrEmpty(item.ends_at), enabled: item.enabled !== false })),
  };
}

export default function AdminPublicConfig() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [section, setSection] = useState('payment');
  const [notificationDraft, setNotificationDraft] = useState(EMPTY_NOTIFICATION);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const { data } = await adminApi.get('/admin/public-config');
    const next = { ...DEFAULT_CONFIG, ...(data.config || {}) };
    next.announcement_starts_at = localDateTime(next.announcement_starts_at);
    next.announcement_ends_at = localDateTime(next.announcement_ends_at);
    next.announcement_notifications = Array.isArray(data.config?.announcement_notifications) ? data.config.announcement_notifications.map((item) => ({ ...EMPTY_NOTIFICATION, ...item, starts_at: localDateTime(item.starts_at), ends_at: localDateTime(item.ends_at) })) : [];
    setConfig(next);
  };
  useEffect(() => { load().catch(() => setError('تعذر تحميل إعدادات الدفع والإعلانات.')); }, []);
  const update = (field, value) => setConfig((current) => ({ ...current, [field]: value }));
  const updateNotification = (field, value) => setNotificationDraft((current) => ({ ...current, [field]: value }));
  const addNotification = () => {
    if (!notificationDraft.title_ar.trim() && !notificationDraft.title_en.trim() && !notificationDraft.message_ar.trim() && !notificationDraft.message_en.trim()) return;
    const item = { ...notificationDraft, id: notificationDraft.id || `notice-${Date.now()}`, title_ar: notificationDraft.title_ar.trim(), title_en: notificationDraft.title_en.trim(), message_ar: notificationDraft.message_ar.trim(), message_en: notificationDraft.message_en.trim(), created_at: new Date().toISOString(), enabled: true };
    setConfig((current) => ({ ...current, announcement_notifications: [item, ...(current.announcement_notifications || [])] }));
    setNotificationDraft(EMPTY_NOTIFICATION);
  };
  const removeNotification = (id) => setConfig((current) => ({ ...current, announcement_notifications: (current.announcement_notifications || []).filter((item) => item.id !== id) }));
  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setMessage(''); setError('');
    try {
      const { data } = await adminApi.patch('/admin/public-config', toPayload(config));
      const next = { ...DEFAULT_CONFIG, ...(data.config || {}) };
      next.announcement_starts_at = localDateTime(next.announcement_starts_at);
      next.announcement_ends_at = localDateTime(next.announcement_ends_at);
      next.announcement_notifications = Array.isArray(data.config?.announcement_notifications) ? data.config.announcement_notifications.map((item) => ({ ...EMPTY_NOTIFICATION, ...item, starts_at: localDateTime(item.starts_at), ends_at: localDateTime(item.ends_at) })) : [];
      setConfig(next);
      setMessage('تم حفظ بيانات الدفع والإعلان. ستظهر التغييرات للمستخدمين حسب فترة الإعلان.');
    } catch (err) {
      setError(err.response?.data?.error || 'تعذر حفظ الإعدادات.');
    } finally { setBusy(false); }
  };

  return <form className="admin-public-config" onSubmit={save}>
    <div className="admin-control-tabs" role="tablist" aria-label="إعدادات الدفع والإعلانات"><button type="button" role="tab" aria-selected={section === 'payment'} className={`admin-control-tab ${section === 'payment' ? 'is-active' : ''}`} onClick={() => setSection('payment')}>بيانات الدفع</button><button type="button" role="tab" aria-selected={section === 'announcement'} className={`admin-control-tab ${section === 'announcement' ? 'is-active' : ''}`} onClick={() => setSection('announcement')}>الإعلانات والإشعارات</button></div>
    {section === 'payment' && <section className="admin-config-card admin-config-card--payment">
      <div className="admin-config-card__heading"><div><span className="admin-config-eyebrow">بيانات استقبال التحويل</span><h3>بيانات الدفع التي تظهر في قسم الاشتراكات</h3><p>حدّث الرقم والحساب والملاحظة مرة واحدة، وستُستخدم تلقائيًا عند اختيار أي باقة.</p></div><span className="admin-config-icon">ر.ع</span></div>
      <div className="admin-public-grid"><label className="label">رقم التحويل<input className="input" value={config.payment_phone} onChange={(e) => update('payment_phone', e.target.value)} placeholder="00968..." required /></label><label className="label">اسم المستلم<input className="input" value={config.payment_recipient} onChange={(e) => update('payment_recipient', e.target.value)} placeholder="اسم صاحب الحساب" /></label><label className="label">طريقة الدفع<input className="input" value={config.payment_method} onChange={(e) => update('payment_method', e.target.value)} placeholder="تحويل بنكي / محفظة" /></label><label className="label">الحساب أو IBAN<input className="input" value={config.payment_account} onChange={(e) => update('payment_account', e.target.value)} /></label><label className="label admin-public-grid__wide">ملاحظة الدفع بالعربية<textarea className="input" rows={2} value={config.payment_note_ar} onChange={(e) => update('payment_note_ar', e.target.value)} placeholder="أرسل صورة الإيصال بعد التحويل." /></label><label className="label admin-public-grid__wide">Payment note in English<textarea className="input" rows={2} value={config.payment_note_en} onChange={(e) => update('payment_note_en', e.target.value)} placeholder="Send the receipt after completing the transfer." /></label></div>
    </section>}

    {section === 'announcement' && <>
    <section className="admin-config-card admin-config-card--announcement">
      <div className="admin-config-card__heading"><div><span className="admin-config-eyebrow">رسالة عامة للمستخدمين</span><h3>إعلان عاجل أو تحديث قريب</h3><p>يظهر أعلى صفحات المعلمين والصفحة العامة بطريقة واضحة وقابلة للإغلاق، ولا يظهر خارج الفترة المحددة.</p></div><span className="admin-config-icon">!</span></div>
      <label className="admin-announcement-toggle"><input type="checkbox" checked={config.announcement_enabled === '1' || config.announcement_enabled === true} onChange={(e) => update('announcement_enabled', e.target.checked ? '1' : '0')} /><span>تفعيل الإعلان وإظهاره للمستخدمين</span></label>
      <div className="admin-public-grid"><label className="label">نوع الإعلان<select className="input" value={config.announcement_type} onChange={(e) => update('announcement_type', e.target.value)}><option value="urgent">عاجل / Important</option><option value="maintenance">صيانة / Maintenance</option><option value="info">معلومة / Information</option></select></label><label className="label">رابط الزر الاختياري<input className="input" type="url" value={config.announcement_cta_url} onChange={(e) => update('announcement_cta_url', e.target.value)} placeholder="https://..." /></label><label className="label">العنوان بالعربية<input className="input" value={config.announcement_title_ar} onChange={(e) => update('announcement_title_ar', e.target.value)} placeholder="تحديث مهم قريبًا" /></label><label className="label">Title in English<input className="input" value={config.announcement_title_en} onChange={(e) => update('announcement_title_en', e.target.value)} placeholder="Important update coming soon" /></label><label className="label admin-public-grid__wide">الرسالة بالعربية<textarea className="input" rows={3} value={config.announcement_message_ar} onChange={(e) => update('announcement_message_ar', e.target.value)} /></label><label className="label admin-public-grid__wide">Message in English<textarea className="input" rows={3} value={config.announcement_message_en} onChange={(e) => update('announcement_message_en', e.target.value)} /></label><label className="label">نص الزر بالعربية<input className="input" value={config.announcement_cta_label_ar} onChange={(e) => update('announcement_cta_label_ar', e.target.value)} /></label><label className="label">Button label in English<input className="input" value={config.announcement_cta_label_en} onChange={(e) => update('announcement_cta_label_en', e.target.value)} /></label><label className="label">يبدأ في<input className="input" type="datetime-local" value={config.announcement_starts_at} onChange={(e) => update('announcement_starts_at', e.target.value)} /></label><label className="label">ينتهي في<input className="input" type="datetime-local" value={config.announcement_ends_at} onChange={(e) => update('announcement_ends_at', e.target.value)} /></label></div>
    </section>
    <section className="admin-config-card admin-config-card--notifications">
      <div className="admin-config-card__heading"><div><span className="admin-config-eyebrow">مركز الإشعارات</span><h3>إشعارات قابلة للمسح</h3><p>أضف إشعارات متعددة؛ يمكن للمعلم إغلاق كل إشعار، ويمكنك تحديد تاريخ انتهائه.</p></div><span className="admin-notification-count">{config.announcement_notifications?.length || 0}</span></div>
      <div className="admin-public-grid"><label className="label">النوع<select className="input" value={notificationDraft.type} onChange={(e) => updateNotification('type', e.target.value)}><option value="urgent">عاجل</option><option value="maintenance">صيانة</option><option value="info">معلومة</option></select></label><label className="label">العنوان بالعربية<input className="input" value={notificationDraft.title_ar} onChange={(e) => updateNotification('title_ar', e.target.value)} /></label><label className="label">Title in English<input className="input" value={notificationDraft.title_en} onChange={(e) => updateNotification('title_en', e.target.value)} /></label><label className="label admin-public-grid__wide">نص الإشعار بالعربية<textarea className="input" rows={2} value={notificationDraft.message_ar} onChange={(e) => updateNotification('message_ar', e.target.value)} /></label><label className="label admin-public-grid__wide">Notification text in English<textarea className="input" rows={2} value={notificationDraft.message_en} onChange={(e) => updateNotification('message_en', e.target.value)} /></label><label className="label admin-public-grid__wide">رابط اختياري<input className="input" type="url" value={notificationDraft.cta_url} onChange={(e) => updateNotification('cta_url', e.target.value)} placeholder="https://..." /></label><label className="label">يبدأ في<input className="input" type="datetime-local" value={notificationDraft.starts_at} onChange={(e) => updateNotification('starts_at', e.target.value)} /></label><label className="label">ينتهي في<input className="input" type="datetime-local" value={notificationDraft.ends_at} onChange={(e) => updateNotification('ends_at', e.target.value)} /></label></div>
      <div className="admin-plan-editor-actions"><button type="button" className="btn-secondary" onClick={addNotification}>+ إضافة إشعار إلى القائمة</button></div>
      <div className="space-y-2 mt-4">{(config.announcement_notifications || []).map((item) => <article key={item.id} className="admin-notification-row"><div className="admin-notification-row__body"><strong>{item.title_ar || item.title_en || 'إشعار'}</strong><p>{item.message_ar || item.message_en || '—'}</p><span className="text-[11px] text-ink/40">{item.ends_at ? `ينتهي في ${new Date(item.ends_at).toLocaleString('ar')}` : 'دون تاريخ انتهاء'}</span></div><button type="button" className="text-danger text-xs" onClick={() => removeNotification(item.id)} aria-label="حذف الإشعار">× حذف</button></article>)}{(!config.announcement_notifications || config.announcement_notifications.length === 0) && <p className="text-sm text-ink/45">لا توجد إشعارات محفوظة.</p>}</div>
    </section></>}
    <div className="admin-public-actions"><button className="btn-primary" type="submit" disabled={busy}>{busy ? 'جارِ الحفظ...' : 'حفظ هذا التبويب'}</button>{message && <span className="save-feedback save-feedback--success">{message}</span>}{error && <span className="save-feedback save-feedback--error">{error}</span>}</div>
  </form>;
}
