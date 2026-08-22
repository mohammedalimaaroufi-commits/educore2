import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import adminApi from '../api/adminClient';
import { connectSocket } from '../api/socket';
import { useLocale } from '../context/LocaleContext.jsx';
import AdminPublicConfig from '../components/AdminPublicConfig.jsx';

const PLAN_LABELS = { '6_months': 'planSixMonths', yearly: 'planYearly', lifetime: 'planLifetime' };
const STATUS_LABELS = { pending: 'statusPending', approved: 'statusApproved', rejected: 'statusRejected' };
const RESTRICTION_FEATURE_OPTIONS = [
  { id: 'students', key: 'featureStudents' },
  { id: 'gradebook', key: 'featureGradebook' },
  { id: 'behavior', key: 'featureBehavior' },
  { id: 'attendance', key: 'featureAttendance' },
  { id: 'analytics', key: 'featureAnalytics' },
  { id: 'reports', key: 'featureReports' },
];

function planLabel(t, plan) {
  const key = PLAN_LABELS[plan];
  return key ? t(key) : plan || t('statusUnknown');
}
const EMPTY_OFFER = { plan: 'yearly', title: '', description: '', original_price_omr: 7, offer_price_omr: 5, starts_at: '', ends_at: '', enabled: true };
const DEFAULT_PLAN_EDITOR = [
  { id: '6_months', title: 'باقة 6 أشهر', base_price_omr: 4, duration_days: 182, note: 'وصول كامل لمدة نصف عام', features: ['دفتر درجات كامل', 'الحضور والسلوك', 'التحليلات والتقارير'], highlight: false },
  { id: 'yearly', title: 'الباقة السنوية', base_price_omr: 7, duration_days: 365, note: 'الأكثر توفيرًا للعام الدراسي', features: ['كل أدوات EduCore', 'نسخ محلية ومزامنة', 'دعم فني مباشر'], highlight: true },
  { id: 'lifetime', title: 'مدى الحياة', base_price_omr: 18, duration_days: null, note: 'دفعة واحدة ووصول دائم', features: ['وصول دائم', 'كل التحديثات المستقبلية', 'أولوية في الدعم'], highlight: false },
];

function toDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function offerPayload(offer) {
  return {
    plan: offer.plan,
    title: offer.title.trim(),
    description: offer.description.trim(),
    original_price_omr: Number(offer.original_price_omr),
    offer_price_omr: Number(offer.offer_price_omr),
    starts_at: offer.starts_at ? new Date(offer.starts_at).toISOString() : null,
    ends_at: offer.ends_at ? new Date(offer.ends_at).toISOString() : null,
    enabled: Boolean(offer.enabled),
  };
}

const MESSAGE_RETENTION_MS = 24 * 60 * 60 * 1000;
function isFreshChatMessage(message) {
  const createdAt = new Date(message?.created_at || 0).getTime();
  return Number.isFinite(createdAt) && Date.now() - createdAt < MESSAGE_RETENTION_MS;
}
function freshChatMessages(items) {
  return (Array.isArray(items) ? items : []).filter(isFreshChatMessage);
}

function chatMessageKey(message) {
  return message?.client_message_id || message?.id;
}

function mergeChatMessage(current, incoming) {
  if (!incoming || !isFreshChatMessage(incoming)) return current;
  const key = chatMessageKey(incoming);
  const index = current.findIndex((message) => chatMessageKey(message) === key || (message.client_message_id && message.client_message_id === incoming.client_message_id));
  if (index < 0) return [...current, incoming].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const next = [...current];
  next[index] = { ...next[index], ...incoming };
  return next;
}

function PaymentRequests() {
  const { t, locale } = useLocale();
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [showArchived, setShowArchived] = useState(false);
  const [viewReceipt, setViewReceipt] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionMessage, setActionMessage] = useState('');
  const [search, setSearch] = useState('');

  const load = async () => {
    const { data } = await adminApi.get('/admin/payment-requests', {
      params: { ...(statusFilter ? { status: statusFilter } : {}), archived: showArchived ? '1' : '0' },
    });
    setRequests(data.requests);
  };
  useEffect(() => { load(); }, [statusFilter, showArchived]);
  const filteredRequests = requests.filter((request) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [request.full_name, request.email, request.plan, request.reference_note].some((value) => String(value || '').toLowerCase().includes(term));
  });

  const approve = async (id) => {
    if (!confirm(t('confirmActivation'))) return;
    setBusyId(id);
    setActionMessage('');
    try {
      await adminApi.post(`/admin/payment-requests/${id}/approve`, {});
      await load();
      setActionMessage(t('activationSuccess'));
    } catch (error) {
      setActionMessage(error.response?.data?.error ? `${error.response.data.error}${error.response.data.plan ? ` (${t('rawPlan')}: ${error.response.data.plan})` : ''}` : t('activationFailed'));
    } finally {
      setBusyId(null);
    }
  };
  const reject = async (id) => {
    const note = prompt(t('rejectReason')) || '';
    setBusyId(id);
    try { await adminApi.post(`/admin/payment-requests/${id}/reject`, { admin_note: note }); await load(); } finally { setBusyId(null); }
  };
  const archive = async (id) => {
    await adminApi.post(`/admin/payment-requests/${id}/archive`, {});
    load();
  };
  const restore = async (id) => {
    await adminApi.post(`/admin/payment-requests/${id}/restore`, {});
    load();
  };
  const remove = async (id) => {
    if (!confirm('حذف هذا الطلب نهائيًا؟ لا يمكن التراجع عن هذا الإجراء.')) return;
    await adminApi.delete(`/admin/payment-requests/${id}`);
    load();
  };

  return (
    <>
      {actionMessage && <div className={`admin-action-feedback ${actionMessage === t('activationSuccess') ? 'is-success' : 'is-error'}`} role="status">{actionMessage}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex gap-2">
          {['pending', 'approved', 'rejected', ''].map((s) => (
            <button key={s || 'all'} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full text-xs border ${statusFilter === s ? 'bg-ink text-white border-ink' : 'border-line'}`}>
              {s ? ({ pending: t('statusPending'), approved: t('statusApproved'), rejected: t('statusRejected') }[s]) : t('all')}
            </button>
          ))}
        </div>
        <button onClick={() => setShowArchived((v) => !v)}
          className={`px-3 py-1 rounded-full text-xs border ${showArchived ? 'bg-accent text-white border-accent' : 'border-line text-ink/60'}`}>
          {showArchived ? `📦 ${t('showArchive')}` : t('showArchive')}
        </button>
      </div>

      <div className="relative mb-3"><input className="input text-sm pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث سريع بالاسم أو البريد أو الباقة أو المرجع" aria-label="بحث في طلبات التفعيل" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/35">⌕</span></div>
      <div className="space-y-3">
        {filteredRequests.map((r) => (
          <div key={r.id} className="card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {r.receipt_image ? (
                <button onClick={() => setViewReceipt(r.receipt_image)}>
                  <img src={r.receipt_image} alt="وصل التحويل" className="w-14 h-14 object-cover rounded-lg border border-line" />
                </button>
              ) : (
                <div className="w-14 h-14 rounded-lg border border-dashed border-line flex items-center justify-center text-[10px] text-ink/40 text-center">{t('noReceipt')}</div>
              )}
              <div>
                <p className="font-bold">{r.full_name} <span className="text-ink/50 text-xs">({r.email})</span></p>
                <p className="text-sm text-ink/70">{t('plan')}: {r.plan_title || planLabel(t, r.plan)} {!r.plan_title && r.plan && !PLAN_LABELS[r.plan] && <small>({t('rawPlan')}: {r.plan})</small>} · {t('amountLabel')}: <strong>{r.amount_omr} {t('currencyOMR')}</strong>{r.original_amount_omr && Number(r.original_amount_omr) !== Number(r.amount_omr) ? ` · ${t('originalPrice')}: ${r.original_amount_omr} ${t('currencyOMR')}` : ''}</p>
                {r.offer_id && <p className="text-xs text-primary/70">{t('offerLabel')}: {r.offer_id}</p>}
                {r.reference_note && <p className="text-xs text-ink/50">{t('teacherNote')}: {r.reference_note}</p>}
                <p className="text-xs text-ink/40">{new Date(r.created_at).toLocaleString(locale === 'ar' ? 'ar' : 'en-US')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-1 rounded-full ${r.status === 'pending' ? 'bg-accent/20 text-ink' : r.status === 'approved' ? 'bg-primary/20 text-primary' : 'bg-danger/20 text-danger'}`}>
                {{ pending: t('statusPending'), approved: t('statusApproved'), rejected: t('statusRejected') }[r.status] || r.status}
              </span>
              {r.status === 'pending' && !showArchived && (
                <>
                  <button className="btn-primary text-xs" disabled={busyId === r.id} onClick={() => approve(r.id)}>{busyId === r.id ? t('activating') : t('activate')}</button>
                  <button className="text-danger text-xs" disabled={busyId === r.id} onClick={() => reject(r.id)}>{t('reject')}</button>
                </>
              )}
              {showArchived ? (
                <>
                  <button className="text-primary text-xs" onClick={() => restore(r.id)}>استعادة</button>
                  <button className="text-danger text-xs" onClick={() => remove(r.id)}>حذف نهائي</button>
                </>
              ) : (
                <button className="text-ink/50 text-xs" onClick={() => archive(r.id)}>أرشفة</button>
              )}
            </div>
          </div>
        ))}
        {filteredRequests.length === 0 && <p className="text-ink/50 text-sm">{requests.length ? 'لا توجد نتائج مطابقة للبحث.' : t('noRequests')}</p>}
      </div>

      {viewReceipt && (
        <div className="fixed inset-0 bg-ink/70 z-50 flex items-center justify-center p-4" onClick={() => setViewReceipt(null)}>
          <img src={viewReceipt} alt="وصل التحويل" className="max-h-[85vh] max-w-full rounded-lg" />
        </div>
      )}
    </>
  );
}

function SubscriptionConfig() {
  const { t } = useLocale();
  const [config, setConfig] = useState({ trial_days: 14, plans: [], plan_definitions: DEFAULT_PLAN_EDITOR, offers: [] });
  const [planDrafts, setPlanDrafts] = useState(DEFAULT_PLAN_EDITOR);
  const [trialDays, setTrialDays] = useState(14);
  const [offer, setOffer] = useState(EMPTY_OFFER);
  const [editingOfferId, setEditingOfferId] = useState(null);
  const [savedMessage, setSavedMessage] = useState('');
  const [planSavedMessage, setPlanSavedMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await adminApi.get('/admin/subscription-config');
    setConfig(data);
    setPlanDrafts((data.plan_definitions || DEFAULT_PLAN_EDITOR).map((plan) => ({ ...plan, features: Array.isArray(plan.features) ? plan.features : [] })));
    setTrialDays(data.trial_days);
  };
  useEffect(() => { load(); }, []);

  const saveTrial = async () => {
    setBusy(true);
    try { await adminApi.patch('/admin/subscription-config', { trial_days: Number(trialDays) }); await load(); } finally { setBusy(false); }
  };
  const updatePlan = (id, field, value) => setPlanDrafts((current) => current.map((plan) => plan.id === id ? { ...plan, [field]: value } : plan));
  const savePlans = async () => {
    setBusy(true);
    setPlanSavedMessage('');
    try {
      const payload = planDrafts.map((plan) => ({
        ...plan,
        base_price_omr: Number(plan.base_price_omr),
        duration_days: plan.duration_days === '' || plan.duration_days === null ? null : Number(plan.duration_days),
        features: Array.isArray(plan.features) ? plan.features : [],
      }));
      const { data } = await adminApi.patch('/admin/subscription-config', { plan_definitions: payload });
      setPlanDrafts(data.plan_definitions || payload);
      setPlanSavedMessage('تم حفظ الباقات الأساسية، وستظهر التغييرات للمعلمين فورًا.');
      await load();
    } catch (error) {
      setPlanSavedMessage(error.response?.data?.error || 'تعذر حفظ الباقات الأساسية.');
    } finally { setBusy(false); }
  };
  const saveOffer = async (event) => {
    event.preventDefault();
    setBusy(true);
    setSavedMessage('');
    try {
      const payload = offerPayload(offer);
      if (!payload.title || !Number.isFinite(payload.original_price_omr) || !Number.isFinite(payload.offer_price_omr)) return;
      if (editingOfferId) await adminApi.patch(`/admin/offers/${editingOfferId}`, payload);
      else await adminApi.post('/admin/offers', payload);
      setOffer(EMPTY_OFFER);
      setEditingOfferId(null);
      setSavedMessage(editingOfferId ? 'تم حفظ تعديل العرض وإظهاره حسب حالته' : 'تم إضافة العرض بنجاح');
      await load();
      window.setTimeout(() => setSavedMessage(''), 3500);
    } finally { setBusy(false); }
  };
  const startEditOffer = (item) => {
    setEditingOfferId(item.id);
    setOffer({ plan: item.plan, title: item.title || '', description: item.description || '', original_price_omr: item.original_price_omr, offer_price_omr: item.offer_price_omr, starts_at: toDateTimeLocal(item.starts_at), ends_at: toDateTimeLocal(item.ends_at), enabled: Boolean(item.enabled) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const cancelEditOffer = () => { setEditingOfferId(null); setOffer(EMPTY_OFFER); };
  const toggleOffer = async (item) => { setBusy(true); try { await adminApi.patch(`/admin/offers/${item.id}`, { enabled: !item.enabled }); await load(); } finally { setBusy(false); } };
  const removeOffer = async (id) => { if (!confirm('حذف هذا العرض؟')) return; await adminApi.delete(`/admin/offers/${id}`); load(); };

  return <div className="admin-subscription-config">
    <div className="admin-config-card admin-config-card--plans">
      <div className="admin-config-card__heading"><div><span className="admin-config-eyebrow">المنتج الأساسي</span><h3>تحرير الباقات الأساسية</h3><p>غيّر اسم الباقة وسعرها وخصائصها. مدة المنتج ثابتة لضمان أن تاريخ الانتهاء يطابق الباقة المفعّلة دائمًا.</p></div><span className="admin-config-icon">◇</span></div>
      <div className="admin-base-plans-grid">{planDrafts.map((plan) => <article key={plan.id} className={`admin-base-plan-editor ${plan.highlight ? 'is-featured' : ''}`}>
        <div className="admin-base-plan-editor__top"><span className="admin-plan-pill">{planLabel(t, plan.id)}</span><label className="admin-featured-toggle"><input type="checkbox" checked={Boolean(plan.highlight)} onChange={(e) => updatePlan(plan.id, 'highlight', e.target.checked)} /><span>مميزة</span></label></div>
        <label className="label">اسم الباقة<input className="input" value={plan.title} onChange={(e) => updatePlan(plan.id, 'title', e.target.value)} /></label>
        <div className="admin-plan-editor-row"><label className="label">السعر الأساسي<input className="input" type="number" min="0.01" step="0.01" value={plan.base_price_omr} onChange={(e) => updatePlan(plan.id, 'base_price_omr', e.target.value)} /></label><label className="label">مدة الباقة<input className="input" type="text" value={plan.duration_days === null ? 'غير محدودة' : `${plan.duration_days} يومًا`} readOnly aria-readonly="true" /><small className="admin-label-hint">مدة المنتج ثابتة لضمان صحة تاريخ الانتهاء.</small></label></div>
        <label className="label">وصف مختصر<input className="input" value={plan.note || ''} onChange={(e) => updatePlan(plan.id, 'note', e.target.value)} /></label>
        <label className="label">خصائص الباقة <span className="admin-label-hint">خاصية واحدة في كل سطر</span><textarea className="input" rows={4} value={(plan.features || []).join('\n')} onChange={(e) => updatePlan(plan.id, 'features', e.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} /></label>
      </article>)}</div>
      <div className="admin-plan-editor-actions"><button className="btn-primary" type="button" disabled={busy} onClick={savePlans}>{busy ? 'جارِ الحفظ...' : 'حفظ الباقات الأساسية'}</button>{planSavedMessage && <span className={`save-feedback ${planSavedMessage.startsWith('تم') ? 'save-feedback--success' : 'save-feedback--error'}`}>{planSavedMessage}</span>}</div>
    </div>
    <div className="admin-config-card admin-config-card--trial"><div className="admin-config-icon">◷</div><div className="flex-1"><span className="admin-config-eyebrow">سياسة الحسابات الجديدة</span><h3>مدة الفترة التجريبية</h3><p>تُطبّق على الحسابات الجديدة فقط، ويمكن تعديلها دون تغيير اشتراكات المعلمين الحاليين.</p></div><div className="admin-inline-edit"><input className="input" type="number" min="1" max="365" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} /><span>يومًا</span><button className="btn-primary" disabled={busy} onClick={saveTrial}>حفظ المدة</button></div></div>
    <div className="admin-config-card admin-config-card--offer"><div className="admin-config-card__heading"><div><span className="admin-config-eyebrow">{editingOfferId ? 'تحرير عرض محفوظ' : 'إنشاء عرض جديد'}</span><h3>{editingOfferId ? 'تعديل تفاصيل العرض' : 'أضف عرضًا يظهر للمعلمين'}</h3><p>يظهر العرض الفعّال في بطاقات الاشتراك مع السعر الأصلي المشطوب وسعر العرض والوصف والفترة المحددة.</p></div>{editingOfferId && <button className="btn-secondary text-sm" type="button" onClick={cancelEditOffer}>إلغاء التحرير</button>}</div><form onSubmit={saveOffer} className="offer-editor-grid"><label className="label">الباقة<select className="input" value={offer.plan} onChange={(e) => setOffer({ ...offer, plan: e.target.value })}>{Object.keys(PLAN_LABELS).filter((id) => id !== 'trial').map((id) => <option key={id} value={id}>{planLabel(t, id)}</option>)}</select></label><label className="label">عنوان العرض<input className="input" placeholder="مثال: عرض العودة للمدارس" value={offer.title} onChange={(e) => setOffer({ ...offer, title: e.target.value })} required /></label><label className="label offer-editor-grid__wide">الوصف الذي سيظهر للمعلم<input className="input" placeholder="مثال: خصم محدود حتى نهاية الشهر" value={offer.description} onChange={(e) => setOffer({ ...offer, description: e.target.value })} /></label><label className="label">السعر الأصلي<input className="input" type="number" min="0.01" step="0.01" value={offer.original_price_omr} onChange={(e) => setOffer({ ...offer, original_price_omr: e.target.value })} required /></label><label className="label">سعر العرض<input className="input" type="number" min="0.01" step="0.01" value={offer.offer_price_omr} onChange={(e) => setOffer({ ...offer, offer_price_omr: e.target.value })} required /></label><label className="label">يبدأ في<input className="input" type="datetime-local" value={offer.starts_at} onChange={(e) => setOffer({ ...offer, starts_at: e.target.value })} /></label><label className="label">ينتهي في<input className="input" type="datetime-local" value={offer.ends_at} onChange={(e) => setOffer({ ...offer, ends_at: e.target.value })} /></label><label className="offer-enabled-toggle"><input type="checkbox" checked={offer.enabled} onChange={(e) => setOffer({ ...offer, enabled: e.target.checked })} /><span>إظهار العرض للمعلمين فورًا إذا كان ضمن الفترة</span></label><div className="offer-editor-actions"><button className="btn-primary" disabled={busy} type="submit">{busy ? 'جارِ الحفظ...' : editingOfferId ? 'حفظ تعديل العرض' : 'إضافة العرض'}</button>{savedMessage && <span className="save-feedback save-feedback--success">{savedMessage}</span>}</div></form></div>
    <div className="admin-offers-list"><div className="admin-config-card__heading"><div><span className="admin-config-eyebrow">المكتبة الحالية</span><h3>العروض المحفوظة</h3><p>راجع حالة كل عرض وعدّل السعر والوصف والفترة من زر التحرير.</p></div><span className="admin-offer-count">{config.offers?.length || 0} عروض</span></div><div className="admin-offers-grid">{(config.offers || []).map((item) => <article key={item.id} className={`admin-offer-row ${item.enabled ? 'is-enabled' : 'is-disabled'}`}><div className="admin-offer-row__status"><span className="admin-offer-status-dot" />{item.enabled ? 'مفعّل' : 'متوقف'}</div><div className="admin-offer-row__body"><div className="flex items-center gap-2 flex-wrap"><h4>{item.title || 'عرض بلا عنوان'}</h4><span className="admin-plan-pill">{planLabel(t, item.plan)}</span></div><p>{item.description || 'لا يوجد وصف للعرض بعد.'}</p><div className="admin-offer-row__meta"><strong><del>{item.original_price_omr} ر.ع</del> {item.offer_price_omr} ر.ع</strong><span>{item.starts_at ? `من ${new Date(item.starts_at).toLocaleDateString('ar')}` : 'فوري'} · {item.ends_at ? `حتى ${new Date(item.ends_at).toLocaleDateString('ar')}` : 'دون انتهاء'}</span></div></div><div className="admin-offer-row__actions"><button className="text-primary text-xs" disabled={busy} onClick={() => startEditOffer(item)}>تحرير</button><button className="text-ink/60 text-xs" disabled={busy} onClick={() => toggleOffer(item)}>{item.enabled ? 'إيقاف' : 'تفعيل'}</button><button className="text-danger text-xs" disabled={busy} onClick={() => removeOffer(item.id)}>حذف</button></div></article>)}{config.offers?.length === 0 && <div className="admin-empty-offers">لا توجد عروض محفوظة. أضف أول عرض ليظهر للمعلمين.</div>}</div></div>
  </div>;
}

function PasswordResetRequests() {
  const [requests, setRequests] = useState([]);
  const [generated, setGenerated] = useState(null);
  const load = async () => { const { data } = await adminApi.get('/admin/password-reset-requests', { params: { status: 'pending' } }); setRequests(data.requests || []); };
  useEffect(() => { load(); }, []);
  const generate = async (id) => {
    const { data } = await adminApi.post(`/admin/password-reset-requests/${id}/generate-link`, {});
    setGenerated(data);
    try { await navigator.clipboard.writeText(data.reset_link); } catch { /* manual copy remains visible */ }
    load();
  };
  const close = async (id) => { await adminApi.post(`/admin/password-reset-requests/${id}/close`, {}); load(); };
  return <div className="space-y-3">
    {generated && <div className="card p-4 border-2 border-primary"><p className="font-bold text-primary mb-1">رابط إعادة التعيين لـ {generated.request?.email}</p><p className="text-xs text-ink/60 mb-2">تم نسخه إلى الحافظة إن سمح المتصفح. أرسله يدويًا إلى بريد المعلم، وهو صالح لمدة 30 دقيقة.</p><div className="flex gap-2"><input className="input text-xs flex-1" readOnly value={generated.reset_link} onFocus={(e) => e.target.select()} /><button className="btn-secondary text-xs" onClick={() => navigator.clipboard?.writeText(generated.reset_link)}>نسخ</button></div></div>}
    {requests.map((request) => <div key={request.id} className="card p-4 flex flex-wrap items-center justify-between gap-3"><div><p className="font-bold">{request.full_name}</p><p className="text-sm text-ink/60">{request.email}</p><p className="text-xs text-ink/40">{new Date(request.created_at).toLocaleString('ar')}</p></div><div className="flex gap-2"><button className="btn-primary text-xs" onClick={() => generate(request.id)}>إنشاء الرابط</button><button className="text-ink/50 text-xs" onClick={() => close(request.id)}>إغلاق</button></div></div>)}
    {requests.length === 0 && <div className="card p-6 text-sm text-ink/50">لا توجد طلبات إعادة تعيين معلقة.</div>}
  </div>;
}

function TeachersList({ onMessage }) {
  const { t, locale } = useLocale();
  const [teachers, setTeachers] = useState([]);
  const [search, setSearch] = useState('');
  const [openTeacherId, setOpenTeacherId] = useState(null);
  const [restrictionDraft, setRestrictionDraft] = useState(null);
  const [restrictionBusy, setRestrictionBusy] = useState(false);
  const [restrictionMessage, setRestrictionMessage] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  useEffect(() => { adminApi.get('/admin/teachers').then(({ data }) => setTeachers(data.teachers || [])).catch(() => setTeachers([])); }, []);
  const filteredTeachers = teachers.filter((teacher) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [teacher.full_name, teacher.email, teacher.school_name, teacher.plan, teacher.plan_title, teacher.status].some((value) => String(value || '').toLowerCase().includes(term));
  });

  const openRestrictions = async (teacher) => {
    if (openTeacherId === teacher.id) {
      setOpenTeacherId(null);
      return;
    }
    setOpenTeacherId(teacher.id);
    setRestrictionMessage('');
    setRestrictionBusy(true);
    try {
      const { data } = await adminApi.get(`/admin/teachers/${teacher.id}/restrictions`);
      setRestrictionDraft({ teacher, ...(data.restrictions || {}), expired: Boolean(data.effective?.expired), effective_active: Boolean(data.effective?.active), blocked_features: [...(data.restrictions?.blocked_features || [])] });
    } catch {
      setRestrictionDraft({ teacher, enabled: false, apply_when_expired: true, blocked_features: [], note: '' });
    } finally { setRestrictionBusy(false); }
  };
  const toggleRestrictionFeature = (feature) => setRestrictionDraft((current) => current ? ({ ...current, blocked_features: current.blocked_features.includes(feature) ? current.blocked_features.filter((item) => item !== feature) : [...current.blocked_features, feature] }) : current);
  const saveRestrictions = async () => {
    if (!restrictionDraft?.teacher?.id) return;
    setRestrictionBusy(true);
    setRestrictionMessage('');
    try {
      const { data } = await adminApi.patch(`/admin/teachers/${restrictionDraft.teacher.id}/restrictions`, {
        enabled: Boolean(restrictionDraft.enabled),
        apply_when_expired: Boolean(restrictionDraft.apply_when_expired),
        blocked_features: restrictionDraft.blocked_features,
        note: restrictionDraft.note || '',
      });
      setRestrictionDraft((current) => ({ ...current, ...data.restrictions }));
      setTeachers((current) => current.map((teacher) => teacher.id === restrictionDraft.teacher.id ? { ...teacher, restrictions: data.restrictions } : teacher));
      setRestrictionMessage(t('restrictionSaved'));
    } catch {
      setRestrictionMessage(t('restrictionSaveFailed'));
    } finally { setRestrictionBusy(false); }
  };
  const updateAccountStatus = async (teacher, status) => {
    setAccountBusy(true);
    setRestrictionMessage('');
    try {
      const { data } = await adminApi.patch(`/admin/teachers/${teacher.id}/account-status`, { status, note: restrictionDraft?.note || '' });
      setTeachers((current) => current.map((item) => item.id === teacher.id ? { ...item, account_status: data.account_status.status, account_note: data.account_status.note } : item));
      setRestrictionDraft((current) => current ? { ...current, account_status: data.account_status.status } : current);
      setRestrictionMessage(t('accountStatusSaved'));
    } catch {
      setRestrictionMessage(t('accountStatusSaveFailed'));
    } finally { setAccountBusy(false); }
  };
  const deleteTeacher = async (teacher) => {
    if (!window.confirm(t('deleteAccountConfirm'))) return;
    setAccountBusy(true);
    setRestrictionMessage('');
    try {
      await adminApi.delete(`/admin/teachers/${teacher.id}`);
      setTeachers((current) => current.filter((item) => item.id !== teacher.id));
      setOpenTeacherId(null);
      setRestrictionDraft(null);
      setRestrictionMessage(t('accountStatusSaved'));
    } catch {
      setRestrictionMessage(t('accountStatusSaveFailed'));
    } finally { setAccountBusy(false); }
  };

  return (
    <div>
      <div className="relative mb-3"><input className="input text-sm pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={locale === 'ar' ? 'بحث سريع باسم المعلم أو البريد أو المدرسة' : 'Quick search by teacher, email, or school'} aria-label={locale === 'ar' ? 'بحث في المعلمين' : 'Search teachers'} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/35">⌕</span></div>
      <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface"><tr>
          <th className="text-right px-4 py-2">{locale === 'ar' ? 'الاسم' : 'Name'}</th>
          <th className="text-right px-4 py-2">{locale === 'ar' ? 'البريد' : 'Email'}</th>
          <th className="text-right px-4 py-2">{t('plan')}</th>
          <th className="text-right px-4 py-2">{t('status')}</th>
          <th className="text-right px-4 py-2">{t('accountStatus')}</th>
          <th className="px-4 py-2"></th>
        </tr></thead>
        <tbody>
          {filteredTeachers.map((teacher) => <React.Fragment key={teacher.id}>
            <tr className="border-t border-line">
              <td className="px-4 py-2">{teacher.full_name}</td>
              <td className="px-4 py-2 text-ink/60">{teacher.email}</td>
              <td className="px-4 py-2">{teacher.plan_title || planLabel(t, teacher.plan) || '—'}</td>
              <td className="px-4 py-2">{teacher.status}</td>
              <td className="px-4 py-2"><span className={`admin-account-status admin-account-status--${teacher.account_status || 'active'}`}>{t({ active: 'accountStatusActive', disabled: 'accountStatusDisabled', banned: 'accountStatusBanned' }[teacher.account_status] || 'accountStatusActive')}</span></td>
              <td className="px-4 py-2 text-left"><div className="flex gap-3 justify-end"><button className="text-primary text-xs" onClick={() => onMessage(teacher)}>{locale === 'ar' ? 'مراسلة' : 'Message'}</button><button className="text-accent text-xs" onClick={() => openRestrictions(teacher)}>{openTeacherId === teacher.id ? '×' : t('restrictionsTitle')}</button></div></td>
            </tr>
            {openTeacherId === teacher.id && <tr key={`${teacher.id}-restrictions`}><td colSpan="6" className="px-4 pb-4"><div className="admin-restrictions-panel">
              <div className="admin-restrictions-panel__heading"><div><strong>{t('subscriberDetails')}: {teacher.full_name}</strong><small>{teacher.plan_title || planLabel(t, teacher.plan)} · {teacher.activated_at ? new Date(teacher.activated_at).toLocaleDateString(locale === 'ar' ? 'ar' : 'en-US') : '—'} → {teacher.expires_at ? new Date(teacher.expires_at).toLocaleDateString(locale === 'ar' ? 'ar' : 'en-US') : t('noExpiry')} · {teacher.days_left === null ? t('noExpiry') : teacher.days_left <= 0 ? t('statusExpired') : t('days', '', { count: teacher.days_left })}</small><small>{t('accountStatus')}: {t({ active: 'accountStatusActive', disabled: 'accountStatusDisabled', banned: 'accountStatusBanned' }[teacher.account_status] || 'accountStatusActive')}</small></div><button type="button" className="text-ink/50 text-xs" onClick={() => setOpenTeacherId(null)}>×</button></div>
              {restrictionBusy && !restrictionDraft ? <p className="text-xs text-ink/50">...</p> : restrictionDraft && <>
                <label className="admin-restriction-toggle"><input type="checkbox" checked={Boolean(restrictionDraft.enabled)} onChange={(event) => setRestrictionDraft({ ...restrictionDraft, enabled: event.target.checked })} /><span>{t('enableRestrictions')}</span></label>
                <label className="admin-restriction-toggle"><input type="checkbox" checked={restrictionDraft.apply_when_expired !== false} onChange={(event) => setRestrictionDraft({ ...restrictionDraft, apply_when_expired: event.target.checked })} /><span>{t('applyRestrictionsOnExpiry')}</span></label>
                <div className="admin-account-actions"><span className="admin-restrictions-label">{t('accountStatus')}</span><button type="button" className="text-primary text-xs" disabled={accountBusy} onClick={() => updateAccountStatus(teacher, 'active')}>{t('restoreAccount')}</button><button type="button" className="text-accent text-xs" disabled={accountBusy} onClick={() => updateAccountStatus(teacher, 'disabled')}>{t('disableAccount')}</button><button type="button" className="text-danger text-xs" disabled={accountBusy} onClick={() => updateAccountStatus(teacher, 'banned')}>{t('banAccount')}</button><button type="button" className="text-danger text-xs font-bold" disabled={accountBusy} onClick={() => deleteTeacher(teacher)}>× {t('deleteAccount')}</button></div>
                <p className="admin-restrictions-label">{t('blockedFeatures')}</p><div className="admin-restrictions-grid">{RESTRICTION_FEATURE_OPTIONS.map((feature) => <label key={feature.id} className="admin-restriction-option"><input type="checkbox" checked={restrictionDraft.blocked_features.includes(feature.id)} onChange={() => toggleRestrictionFeature(feature.id)} /><span>{t(feature.key)}</span></label>)}</div>
                <label className="label">{t('restrictionNote')}<textarea className="input" rows="2" value={restrictionDraft.note || ''} onChange={(event) => setRestrictionDraft({ ...restrictionDraft, note: event.target.value })} /></label>
                <div className="flex items-center gap-3"><button type="button" className="btn-primary text-xs" disabled={restrictionBusy} onClick={saveRestrictions}>{restrictionBusy ? '...' : t('saveRestrictions')}</button>{restrictionMessage && <span className="text-xs text-primary">{restrictionMessage}</span>}</div>
              </>}
            </div></td></tr>}
          </React.Fragment>)}
        </tbody>
      </table>
      {filteredTeachers.length === 0 && <p className="p-4 text-sm text-ink/50">{teachers.length ? (locale === 'ar' ? 'لا توجد نتائج مطابقة للبحث.' : 'No matching results.') : (locale === 'ar' ? 'لا يوجد معلمون بعد.' : 'No teachers yet.')}</p>}
      </div>
    </div>
  );
}

function BroadcastComposer({ onSent }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (!confirm('سيتم إرسال هذه الرسالة إلى جميع المعلمين المسجلين. متابعة؟')) return;
    setBusy(true);
    try {
      const { data } = await adminApi.post('/admin/broadcast', { text });
      setResult(`تم الإرسال إلى ${data.sentTo} معلمًا ✓`);
      setText('');
      onSent?.();
      setTimeout(() => setResult(''), 3000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-3 mb-3">
      {!open ? (
        <button className="text-primary text-sm font-medium" onClick={() => setOpen(true)}>📢 إرسال رسالة جماعية لكل المعلمين</button>
      ) : (
        <form onSubmit={send} className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">رسالة جماعية لكل المعلمين</span>
            <button type="button" className="text-ink/40 text-xs" onClick={() => setOpen(false)}>إغلاق</button>
          </div>
          <textarea className="input text-sm" rows={3} placeholder="اكتب الرسالة التي ستصل لكل المعلمين..." value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex items-center gap-2">
            <button className="btn-primary text-sm" disabled={busy} type="submit">{busy ? '...' : 'إرسال للجميع'}</button>
            {result && <span className="text-primary text-xs">{result}</span>}
          </div>
        </form>
      )}
    </div>
  );
}

function ChatPanel({ initialTeacher }) {
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(initialTeacher || null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const socketRef = useRef(null);
  const scrollRef = useRef(null);

  const loadConversations = async () => {
    const { data } = await adminApi.get('/admin/conversations');
    setConversations(data.conversations);
  };

  useEffect(() => {
    loadConversations();
    const token = localStorage.getItem('educore_admin_token');
    if (!token) return undefined;
    const socket = connectSocket(token, {
      onReconnect: loadConversations,
      onError: (err) => console.warn('Admin chat connection error', err.message),
    });
    socketRef.current = socket;
    socket.on('new_message', (msg) => {
      setConversations((prev) => {
        const existing = prev.find((conversation) => conversation.teacher_id === msg.teacher_id);
        if (!existing) {
          void loadConversations();
          return prev;
        }
        const updated = {
          ...existing,
          last_message: msg.text,
          last_message_at: msg.created_at,
          unread_count: msg.sender === 'teacher' ? Number(existing.unread_count || 0) + 1 : existing.unread_count,
        };
        return [updated, ...prev.filter((conversation) => conversation.teacher_id !== msg.teacher_id)];
      });
      setActive((current) => {
        if (current && current.teacher_id === msg.teacher_id) setMessages((prev) => mergeChatMessage(prev, msg));
        return current;
      });
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (initialTeacher) setActive(initialTeacher);
  }, [initialTeacher]);

  useEffect(() => {
    if (!active) return;
    adminApi.get(`/admin/messages/${active.teacher_id}`).then(({ data }) => setMessages(freshChatMessages(data.messages)));
    socketRef.current?.emit('join_conversation', active.teacher_id);
    setConversations((prev) => prev.map((conversation) => (
      conversation.teacher_id === active.teacher_id
        ? { ...conversation, unread_count: 0 }
        : conversation
    )));
  }, [active]);

  useEffect(() => {
    const timer = window.setInterval(() => setMessages((current) => freshChatMessages(current)), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || !active) return;
    const draft = text.trim();
    setText('');
    const clientMessageId = `admin-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic = {
      id: `local-${clientMessageId}`,
      client_message_id: clientMessageId,
      teacher_id: active.teacher_id,
      sender: 'admin',
      text: draft,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => mergeChatMessage(prev, optimistic));
    try {
      const { data } = await adminApi.post(`/admin/messages/${active.teacher_id}`, { text: draft, client_message_id: clientMessageId });
      setMessages((prev) => mergeChatMessage(prev, data.message));
    } catch (err) {
      setMessages((prev) => prev.filter((message) => chatMessageKey(message) !== clientMessageId));
      setText(draft);
      console.error('Unable to send admin message', err);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-3">
        <BroadcastComposer onSent={loadConversations} />
      </div>
      <div className="card overflow-y-auto" style={{ height: 500 }}>
        {conversations.map((c) => (
          <button key={c.teacher_id} onClick={() => setActive(c)}
            className={`w-full text-right p-3 border-b border-line hover:bg-surface ${active?.teacher_id === c.teacher_id ? 'bg-surface' : ''}`}>
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{c.full_name}</span>
              {c.unread_count > 0 && <span className="bg-danger text-white text-[10px] rounded-full px-1.5 py-0.5">{c.unread_count}</span>}
            </div>
            <p className="text-xs text-ink/50 truncate">{c.last_message}</p>
          </button>
        ))}
        {conversations.length === 0 && <p className="text-ink/50 text-sm p-4">لا توجد محادثات بعد. راسل معلمًا من تبويب "كل المعلمين".</p>}
      </div>

      <div className="card md:col-span-2 flex flex-col overflow-hidden" style={{ height: 500 }}>
        {!active ? (
          <p className="text-ink/50 text-sm p-6">اختر محادثة لعرضها.</p>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-line font-bold text-sm">{active.full_name}</div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-surface">
              {messages.map((m) => (
                <div key={m.id} className={`max-w-[75%] px-3 py-2 rounded-xl2 text-sm ${m.sender === 'admin' ? 'bg-primary text-white mr-auto' : 'bg-white border border-line ml-auto'}`}>
                  {m.text}
                  <div className={`text-[10px] mt-1 ${m.sender === 'admin' ? 'text-white/70' : 'text-ink/40'}`}>
                    {new Date(m.created_at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={send} className="p-2 border-t border-line flex gap-2">
              <input className="input text-sm flex-1" placeholder="اكتب ردًا..." value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn-primary text-sm px-3" type="submit">إرسال</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('requests');
  const [chatTarget, setChatTarget] = useState(null);

  useEffect(() => {
    if (!localStorage.getItem('educore_admin_token')) navigate('/admin/login');
  }, [navigate]);

  const logout = () => { localStorage.removeItem('educore_admin_token'); navigate('/admin/login'); };

  const goToChat = (teacher) => {
    setChatTarget({ teacher_id: teacher.id, full_name: teacher.full_name });
    setTab('chat');
  };

  return (
    <div className="admin-page-shell">
      <div className="admin-page-fixed-header">
        <header className="admin-page-hero"><div><span className="admin-eyebrow">مركز التشغيل</span><h1>لوحة تحكم المسؤول</h1><p>أدر طلبات التفعيل، العروض، المعلمين، الدعم، وإعدادات التجربة من مساحة واحدة.</p></div><div className="admin-hero-stamp"><span>ADMIN</span><small>EduCore control room</small></div><button className="btn-secondary text-sm admin-logout" onClick={logout}>تسجيل الخروج</button></header>
        <nav className="admin-tabs" aria-label="أقسام لوحة المسؤول">
          <button onClick={() => setTab('requests')} className={`admin-tab ${tab === 'requests' ? 'is-active' : ''}`}><span>01</span>طلبات التفعيل</button>
          <button onClick={() => setTab('teachers')} className={`admin-tab ${tab === 'teachers' ? 'is-active' : ''}`}><span>02</span>كل المعلمين</button>
          <button onClick={() => setTab('subscriptions')} className={`admin-tab ${tab === 'subscriptions' ? 'is-active' : ''}`}><span>03</span>الاشتراكات والعروض</button>
          <button onClick={() => setTab('public-config')} className={`admin-tab ${tab === 'public-config' ? 'is-active' : ''}`}><span>04</span>الدفع والإعلانات</button>
          <button onClick={() => setTab('passwords')} className={`admin-tab ${tab === 'passwords' ? 'is-active' : ''}`}><span>05</span>طلبات كلمات المرور</button>
          <button onClick={() => setTab('chat')} className={`admin-tab ${tab === 'chat' ? 'is-active' : ''}`}><span>06</span>الدردشة مع المعلمين</button>
        </nav>
      </div>
      <main className="admin-page-content">
        {tab === 'requests' && <PaymentRequests />}
        {tab === 'teachers' && <TeachersList onMessage={goToChat} />}
        {tab === 'subscriptions' && <SubscriptionConfig />}
        {tab === 'public-config' && <AdminPublicConfig />}
        {tab === 'passwords' && <PasswordResetRequests />}
        {tab === 'chat' && <ChatPanel initialTeacher={chatTarget} />}
      </main>
    </div>
  );
}
