import React, { useEffect, useState } from 'react';
import adminApi from '../api/adminClient';

const EMPTY_NOTIFICATION = { id: '', type: 'info', title_ar: '', title_en: '', message_ar: '', message_en: '', enabled: true };

const DEFAULT_CONFIG = {
  payment_phone: '', payment_recipient: '', payment_account: '',
  announcement_enabled: '0', announcement_type: 'maintenance', announcement_title_ar: '', announcement_title_en: '',
  announcement_message_ar: '', announcement_message_en: '', announcement_notifications: [],
};

function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    announcement_notifications: Array.isArray(raw.announcement_notifications)
      ? raw.announcement_notifications.map((item) => ({ ...EMPTY_NOTIFICATION, ...item }))
      : [],
  };
}

function toSectionPayload(section, config) {
  if (section === 'payment') {
    return {
      payment_phone: config.payment_phone.trim(),
      payment_recipient: config.payment_recipient.trim(),
      payment_account: config.payment_account.trim(),
    };
  }
  if (section === 'announcement') {
    return {
      announcement_enabled: '1',
      announcement_type: config.announcement_type || 'maintenance',
      announcement_title_ar: config.announcement_title_ar.trim(),
      announcement_title_en: config.announcement_title_en.trim(),
      announcement_message_ar: config.announcement_message_ar.trim(),
      announcement_message_en: config.announcement_message_en.trim(),
      // The simplified editor publishes immediately instead of waiting for a date window.
      announcement_starts_at: '',
      announcement_ends_at: '',
      announcement_cta_label_ar: '',
      announcement_cta_label_en: '',
      announcement_cta_url: '',
    };
  }
  return {
    announcement_notifications: (config.announcement_notifications || []).map((item) => ({
      id: item.id || `notice-${Date.now()}`,
      type: item.type || 'info',
      title_ar: String(item.title_ar || '').trim(),
      title_en: String(item.title_en || '').trim(),
      message_ar: String(item.message_ar || '').trim(),
      message_en: String(item.message_en || '').trim(),
      enabled: item.enabled !== false,
      created_at: item.created_at || new Date().toISOString(),
      starts_at: null,
      ends_at: null,
      cta_url: '',
    })),
  };
}

export default function AdminPublicConfig({ section = 'payment' }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [notificationDraft, setNotificationDraft] = useState(EMPTY_NOTIFICATION);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const { data } = await adminApi.get('/admin/public-config');
    setConfig(normalizeConfig(data.config));
  };

  useEffect(() => {
    setMessage('');
    setError('');
    load().catch(() => setError('تعذر تحميل هذا القسم حاليًا.'));
  }, [section]);

  const update = (field, value) => setConfig((current) => ({ ...current, [field]: value }));
  const updateNotification = (field, value) => setNotificationDraft((current) => ({ ...current, [field]: value }));

  const persist = async (payload, successText) => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const { data } = await adminApi.patch('/admin/public-config', payload);
      setConfig(normalizeConfig(data.config));
      setMessage(successText);
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'تعذر حفظ التغييرات.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveCurrentSection = async (event) => {
    event.preventDefault();
    if (section === 'payment' && config.payment_phone.trim().length < 3) {
      setError('أدخل رقم التحويل أولًا.');
      return;
    }
    if (section === 'announcement' && !config.announcement_title_ar.trim() && !config.announcement_title_en.trim() && !config.announcement_message_ar.trim() && !config.announcement_message_en.trim()) {
      setError('أدخل عنوان الإعلان أو رسالته قبل النشر.');
      return;
    }
    await persist(toSectionPayload(section, config), section === 'payment' ? 'تم حفظ بيانات الدفع فقط.' : 'تم حفظ الإعلان وسيظهر فورًا للمستخدمين المتصلين.');
  };

  const hideAnnouncement = async () => {
    await persist({ announcement_enabled: '0' }, 'تم إخفاء الإعلان عن المستخدمين.');
  };

  const addNotification = async () => {
    const hasContent = notificationDraft.title_ar.trim() || notificationDraft.title_en.trim() || notificationDraft.message_ar.trim() || notificationDraft.message_en.trim();
    if (!hasContent) {
      setError('أدخل عنوان الإشعار أو نصه قبل الإضافة.');
      return;
    }
    const item = {
      ...notificationDraft,
      id: notificationDraft.id || `notice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title_ar: notificationDraft.title_ar.trim(),
      title_en: notificationDraft.title_en.trim(),
      message_ar: notificationDraft.message_ar.trim(),
      message_en: notificationDraft.message_en.trim(),
      enabled: true,
      created_at: new Date().toISOString(),
    };
    const nextConfig = { ...config, announcement_notifications: [item, ...(config.announcement_notifications || [])] };
    const saved = await persist(toSectionPayload('notifications', nextConfig), 'تم نشر الإشعار فورًا للمستخدمين.');
    if (saved) setNotificationDraft(EMPTY_NOTIFICATION);
  };

  const removeNotification = async (id) => {
    const nextConfig = { ...config, announcement_notifications: (config.announcement_notifications || []).filter((item) => item.id !== id) };
    await persist(toSectionPayload('notifications', nextConfig), 'تم حذف الإشعار من جميع حسابات المستخدمين.');
  };

  const isAnnouncement = section === 'announcement';
  const isNotifications = section === 'notifications';

  return <form className="admin-public-config" onSubmit={saveCurrentSection}>
    {section === 'payment' && <section className="admin-config-card admin-config-card--payment">
      <div className="admin-config-card__heading"><div><span className="admin-config-eyebrow">بيانات استقبال التحويل</span><h3>بيانات الدفع</h3><p>يكفي إدخال رقم التحويل. اسم المستلم والحساب اختياريان ويظهران للمعلم عند طلب الاشتراك.</p></div><span className="admin-config-icon">ر.ع</span></div>
      <div className="admin-public-grid admin-public-grid--compact">
        <label className="label admin-public-grid__wide">رقم التحويل<input className="input" value={config.payment_phone} onChange={(e) => update('payment_phone', e.target.value)} placeholder="00968..." required /></label>
        <label className="label">اسم المستلم <span className="admin-label-hint">اختياري</span><input className="input" value={config.payment_recipient} onChange={(e) => update('payment_recipient', e.target.value)} placeholder="اسم صاحب الحساب" /></label>
        <label className="label">الحساب أو IBAN <span className="admin-label-hint">اختياري</span><input className="input" value={config.payment_account} onChange={(e) => update('payment_account', e.target.value)} placeholder="اختياري" /></label>
      </div>
    </section>}

    {isAnnouncement && <section className="admin-config-card admin-config-card--announcement">
      <div className="admin-config-card__heading"><div><span className="admin-config-eyebrow">رسالة عامة للمستخدمين</span><h3>إعلان عاجل أو تحديث</h3><p>أدخل النص الأساسي فقط. عند الحفظ يُنشر الإعلان فورًا، ويمكن للمستخدم إغلاقه من شاشته.</p></div><span className="admin-config-icon">!</span></div>
      <div className="admin-announcement-publish-note"><span className="admin-announcement-publish-dot" aria-hidden="true" /> <strong>النشر الفوري مفعّل</strong><span>سيظهر الإعلان للمستخدمين مباشرة عند الضغط على «حفظ ونشر الإعلان».</span></div>
      <div className="admin-public-grid admin-public-grid--compact">
        <label className="label">نوع الإعلان<select className="input" value={config.announcement_type} onChange={(e) => update('announcement_type', e.target.value)}><option value="urgent">عاجل</option><option value="maintenance">صيانة</option><option value="info">معلومة</option></select></label>
        <label className="label">العنوان بالعربية<input className="input" value={config.announcement_title_ar} onChange={(e) => update('announcement_title_ar', e.target.value)} placeholder="تحديث مهم قريبًا" /></label>
        <label className="label">العنوان بالإنجليزية <span className="admin-label-hint">اختياري</span><input className="input" value={config.announcement_title_en} onChange={(e) => update('announcement_title_en', e.target.value)} placeholder="Important update" /></label>
        <label className="label admin-public-grid__wide">الرسالة بالعربية<textarea className="input" rows={3} value={config.announcement_message_ar} onChange={(e) => update('announcement_message_ar', e.target.value)} placeholder="اكتب الرسالة التي ستظهر للمستخدمين..." /></label>
        <label className="label admin-public-grid__wide">الرسالة بالإنجليزية <span className="admin-label-hint">اختياري</span><textarea className="input" rows={2} value={config.announcement_message_en} onChange={(e) => update('announcement_message_en', e.target.value)} placeholder="Optional English message" /></label>
      </div>
    </section>}

    {isNotifications && <section className="admin-config-card admin-config-card--notifications">
      <div className="admin-config-card__heading"><div><span className="admin-config-eyebrow">مركز الإشعارات</span><h3>إشعارات قابلة للمسح</h3><p>أضف عنوانًا أو نصًا فقط. النشر والحذف يتمان مباشرة دون زر حفظ إضافي أو تواريخ مربكة.</p></div><span className="admin-notification-count">{config.announcement_notifications?.length || 0}</span></div>
      <div className="admin-public-grid admin-public-grid--compact">
        <label className="label">النوع<select className="input" value={notificationDraft.type} onChange={(e) => updateNotification('type', e.target.value)}><option value="urgent">عاجل</option><option value="maintenance">صيانة</option><option value="info">معلومة</option></select></label>
        <label className="label">العنوان بالعربية<input className="input" value={notificationDraft.title_ar} onChange={(e) => updateNotification('title_ar', e.target.value)} placeholder="عنوان قصير" /></label>
        <label className="label">العنوان بالإنجليزية <span className="admin-label-hint">اختياري</span><input className="input" value={notificationDraft.title_en} onChange={(e) => updateNotification('title_en', e.target.value)} placeholder="Optional title" /></label>
        <label className="label admin-public-grid__wide">نص الإشعار بالعربية<textarea className="input" rows={2} value={notificationDraft.message_ar} onChange={(e) => updateNotification('message_ar', e.target.value)} placeholder="اكتب الإشعار هنا..." /></label>
        <label className="label admin-public-grid__wide">النص بالإنجليزية <span className="admin-label-hint">اختياري</span><textarea className="input" rows={2} value={notificationDraft.message_en} onChange={(e) => updateNotification('message_en', e.target.value)} placeholder="Optional notification text" /></label>
      </div>
      <div className="admin-public-actions"><button type="button" className="btn-primary" onClick={addNotification} disabled={busy}>{busy ? 'جارِ النشر...' : '+ نشر الإشعار فورًا'}</button></div>
      <div className="admin-notification-list">{(config.announcement_notifications || []).map((item) => <article key={item.id} className="admin-notification-row"><div className="admin-notification-row__body"><div className="admin-notification-row__top"><span className={`admin-notification-type admin-notification-type--${item.type || 'info'}`}>{item.type === 'urgent' ? 'عاجل' : item.type === 'maintenance' ? 'صيانة' : 'معلومة'}</span><strong>{item.title_ar || item.title_en || 'إشعار'}</strong></div><p>{item.message_ar || item.message_en || '—'}</p><small>{item.title_en || item.message_en ? 'AR / EN' : 'AR'}</small></div><button type="button" className="admin-notification-delete" onClick={() => removeNotification(item.id)} disabled={busy} aria-label="حذف الإشعار" title="حذف الإشعار">×</button></article>)}{(!config.announcement_notifications || config.announcement_notifications.length === 0) && <p className="admin-empty-notifications">لا توجد إشعارات منشورة حاليًا.</p>}</div>
    </section>}

    {!isNotifications && <div className="admin-public-actions"><button className="btn-primary" type="submit" disabled={busy}>{busy ? 'جارِ الحفظ...' : isAnnouncement ? 'حفظ ونشر الإعلان' : 'حفظ بيانات الدفع'}</button>{isAnnouncement && <button className="btn-secondary admin-announcement-hide" type="button" onClick={hideAnnouncement} disabled={busy}>إخفاء الإعلان</button>}{message && <span className="save-feedback save-feedback--success" role="status">{message}</span>}{error && <span className="save-feedback save-feedback--error" role="alert">{error}</span>}</div>}
    {isNotifications && (message || error) && <div className={`admin-action-feedback ${error ? 'is-error' : 'is-success'}`} role={error ? 'alert' : 'status'}>{error || message}</div>}
  </form>;
}
