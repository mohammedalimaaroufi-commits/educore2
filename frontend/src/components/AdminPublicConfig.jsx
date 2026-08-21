import React, { useEffect, useState } from 'react';
import adminApi from '../api/adminClient';

const DEFAULT_CONFIG = {
  payment_phone: '', payment_recipient: '', payment_method: '', payment_account: '', payment_note_ar: '', payment_note_en: '',
  announcement_enabled: '0', announcement_type: 'maintenance', announcement_title_ar: '', announcement_title_en: '',
  announcement_message_ar: '', announcement_message_en: '', announcement_cta_label_ar: '', announcement_cta_label_en: '', announcement_cta_url: '',
  announcement_starts_at: '', announcement_ends_at: '',
};

function localDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toPayload(config) {
  return {
    ...config,
    announcement_enabled: config.announcement_enabled === true || config.announcement_enabled === '1' ? '1' : '0',
    announcement_starts_at: config.announcement_starts_at ? new Date(config.announcement_starts_at).toISOString() : '',
    announcement_ends_at: config.announcement_ends_at ? new Date(config.announcement_ends_at).toISOString() : '',
  };
}

export default function AdminPublicConfig() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const { data } = await adminApi.get('/admin/public-config');
    const next = { ...DEFAULT_CONFIG, ...(data.config || {}) };
    next.announcement_starts_at = localDateTime(next.announcement_starts_at);
    next.announcement_ends_at = localDateTime(next.announcement_ends_at);
    setConfig(next);
  };
  useEffect(() => { load().catch(() => setError('تعذر تحميل إعدادات الدفع والإعلانات.')); }, []);
  const update = (field, value) => setConfig((current) => ({ ...current, [field]: value }));
  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setMessage(''); setError('');
    try {
      const { data } = await adminApi.patch('/admin/public-config', toPayload(config));
      const next = { ...DEFAULT_CONFIG, ...(data.config || {}) };
      next.announcement_starts_at = localDateTime(next.announcement_starts_at);
      next.announcement_ends_at = localDateTime(next.announcement_ends_at);
      setConfig(next);
      setMessage('تم حفظ بيانات الدفع والإعلان. ستظهر التغييرات للمستخدمين حسب فترة الإعلان.');
    } catch (err) {
      setError(err.response?.data?.error || 'تعذر حفظ الإعدادات.');
    } finally { setBusy(false); }
  };

  return <form className="admin-public-config" onSubmit={save}>
    <section className="admin-config-card admin-config-card--payment">
      <div className="admin-config-card__heading"><div><span className="admin-config-eyebrow">بيانات استقبال التحويل</span><h3>بيانات الدفع التي تظهر في قسم الاشتراكات</h3><p>حدّث الرقم والحساب والملاحظة مرة واحدة، وستُستخدم تلقائيًا عند اختيار أي باقة.</p></div><span className="admin-config-icon">ر.ع</span></div>
      <div className="admin-public-grid"><label className="label">رقم التحويل<input className="input" value={config.payment_phone} onChange={(e) => update('payment_phone', e.target.value)} placeholder="00968..." required /></label><label className="label">اسم المستلم<input className="input" value={config.payment_recipient} onChange={(e) => update('payment_recipient', e.target.value)} placeholder="اسم صاحب الحساب" /></label><label className="label">طريقة الدفع<input className="input" value={config.payment_method} onChange={(e) => update('payment_method', e.target.value)} placeholder="تحويل بنكي / محفظة" /></label><label className="label">الحساب أو IBAN<input className="input" value={config.payment_account} onChange={(e) => update('payment_account', e.target.value)} /></label><label className="label admin-public-grid__wide">ملاحظة الدفع بالعربية<textarea className="input" rows={2} value={config.payment_note_ar} onChange={(e) => update('payment_note_ar', e.target.value)} placeholder="أرسل صورة الإيصال بعد التحويل." /></label><label className="label admin-public-grid__wide">Payment note in English<textarea className="input" rows={2} value={config.payment_note_en} onChange={(e) => update('payment_note_en', e.target.value)} placeholder="Send the receipt after completing the transfer." /></label></div>
    </section>

    <section className="admin-config-card admin-config-card--announcement">
      <div className="admin-config-card__heading"><div><span className="admin-config-eyebrow">رسالة عامة للمستخدمين</span><h3>إعلان عاجل أو تحديث قريب</h3><p>يظهر أعلى صفحات المعلمين والصفحة العامة بطريقة واضحة وقابلة للإغلاق، ولا يظهر خارج الفترة المحددة.</p></div><span className="admin-config-icon">!</span></div>
      <label className="admin-announcement-toggle"><input type="checkbox" checked={config.announcement_enabled === '1' || config.announcement_enabled === true} onChange={(e) => update('announcement_enabled', e.target.checked ? '1' : '0')} /><span>تفعيل الإعلان وإظهاره للمستخدمين</span></label>
      <div className="admin-public-grid"><label className="label">نوع الإعلان<select className="input" value={config.announcement_type} onChange={(e) => update('announcement_type', e.target.value)}><option value="urgent">عاجل / Important</option><option value="maintenance">صيانة / Maintenance</option><option value="info">معلومة / Information</option></select></label><label className="label">رابط الزر الاختياري<input className="input" type="url" value={config.announcement_cta_url} onChange={(e) => update('announcement_cta_url', e.target.value)} placeholder="https://..." /></label><label className="label">العنوان بالعربية<input className="input" value={config.announcement_title_ar} onChange={(e) => update('announcement_title_ar', e.target.value)} placeholder="تحديث مهم قريبًا" /></label><label className="label">Title in English<input className="input" value={config.announcement_title_en} onChange={(e) => update('announcement_title_en', e.target.value)} placeholder="Important update coming soon" /></label><label className="label admin-public-grid__wide">الرسالة بالعربية<textarea className="input" rows={3} value={config.announcement_message_ar} onChange={(e) => update('announcement_message_ar', e.target.value)} /></label><label className="label admin-public-grid__wide">Message in English<textarea className="input" rows={3} value={config.announcement_message_en} onChange={(e) => update('announcement_message_en', e.target.value)} /></label><label className="label">نص الزر بالعربية<input className="input" value={config.announcement_cta_label_ar} onChange={(e) => update('announcement_cta_label_ar', e.target.value)} /></label><label className="label">Button label in English<input className="input" value={config.announcement_cta_label_en} onChange={(e) => update('announcement_cta_label_en', e.target.value)} /></label><label className="label">يبدأ في<input className="input" type="datetime-local" value={config.announcement_starts_at} onChange={(e) => update('announcement_starts_at', e.target.value)} /></label><label className="label">ينتهي في<input className="input" type="datetime-local" value={config.announcement_ends_at} onChange={(e) => update('announcement_ends_at', e.target.value)} /></label></div>
    </section>
    <div className="admin-public-actions"><button className="btn-primary" type="submit" disabled={busy}>{busy ? 'جارِ الحفظ...' : 'حفظ بيانات الدفع والإعلان'}</button>{message && <span className="save-feedback save-feedback--success">{message}</span>}{error && <span className="save-feedback save-feedback--error">{error}</span>}</div>
  </form>;
}
