import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import adminApi from '../api/adminClient';
import { connectSocket, releaseSocket } from '../api/socket';
import { useLocale } from '../context/LocaleContext.jsx';
import AdminPublicConfig from '../components/AdminPublicConfig.jsx';
import { useConfirmDialog, useTextDialog } from '../components/ConfirmDialog.jsx';
import { omrWithEquivalent } from '../constants.js';
import { localizeApiError } from '../utils/apiError.js';

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
  { id: '6_months', title: 'باقة 6 أشهر', base_price_omr: 4, duration_days: 182, included_students: 120, extra_student_price_omr: 0.1, note: 'وصول كامل لمدة نصف عام', features: ['دفتر درجات كامل', 'الحضور والسلوك', 'التحليلات والتقارير'], highlight: false },
  { id: 'yearly', title: 'الباقة السنوية', base_price_omr: 7, duration_days: 365, included_students: 120, extra_student_price_omr: 0.1, note: 'الأكثر توفيرًا للعام الدراسي', features: ['كل أدوات EduCore', 'نسخ محلية ومزامنة', 'دعم فني مباشر'], highlight: true },
  { id: 'lifetime', title: 'مدى الحياة', base_price_omr: 18, duration_days: null, included_students: 120, extra_student_price_omr: 0.1, note: 'دفعة واحدة ووصول دائم', features: ['وصول دائم', 'كل التحديثات المستقبلية', 'أولوية في الدعم'], highlight: false },
];
const DEFAULT_PLAN_TRANSLATIONS = {
  '6_months': { title: 'planSixMonths', note: 'planSixMonthsNote', features: ['featureGradebook', 'featureAttendanceBehavior', 'featureAnalyticsReports'] },
  yearly: { title: 'planYearly', note: 'planYearlyNote', features: ['featureAllTools', 'featureLocalSync', 'featureSupport'] },
  lifetime: { title: 'planLifetime', note: 'planLifetimeNote', features: ['featureLifetime', 'featureFutureUpdates', 'featurePrioritySupport'] },
};
function localizeDefaultEditorPlan(plan, t) {
  const fallback = DEFAULT_PLAN_EDITOR.find((item) => item.id === plan?.id);
  const translation = DEFAULT_PLAN_TRANSLATIONS[plan?.id];
  if (!fallback || !translation) return { ...plan, features: Array.isArray(plan?.features) ? plan.features : [] };
  const normalized = { ...plan, features: Array.isArray(plan.features) ? plan.features : [] };
  if (String(normalized.title || '').trim() === fallback.title) normalized.title = t(translation.title);
  if (String(normalized.note || '').trim() === fallback.note) normalized.note = t(translation.note);
  if (normalized.features.length === fallback.features.length && normalized.features.every((feature, index) => feature === fallback.features[index])) normalized.features = translation.features.map((key) => t(key));
  return normalized;
}
function localizedDefaultEditorPlans(plans, t) {
  const source = Array.isArray(plans) && plans.length ? plans : DEFAULT_PLAN_EDITOR;
  return source.map((plan) => localizeDefaultEditorPlan(plan, t));
}
function restoreUnchangedDefaultEditorFields(plan, original, t) {
  const fallback = DEFAULT_PLAN_EDITOR.find((item) => item.id === plan?.id);
  const translation = DEFAULT_PLAN_TRANSLATIONS[plan?.id];
  if (!fallback || !translation || !original) return plan;
  const localizedFallback = localizeDefaultEditorPlan(fallback, t);
  const restored = { ...plan };
  if (String(original.title || '').trim() === fallback.title && String(plan.title || '').trim() === String(localizedFallback.title || '').trim()) restored.title = original.title;
  if (String(original.note || '').trim() === fallback.note && String(plan.note || '').trim() === String(localizedFallback.note || '').trim()) restored.note = original.note;
  if (Array.isArray(original.features) && original.features.length === fallback.features.length && original.features.every((feature, index) => feature === fallback.features[index]) && Array.isArray(plan.features) && plan.features.join('\n') === localizedFallback.features.join('\n')) restored.features = original.features;
  return restored;
}

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
  const { confirm, confirmDialog } = useConfirmDialog();
  const { askText, textDialog } = useTextDialog();
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
    const accepted = await confirm({ title: t('activate'), message: t('confirmActivation'), confirmLabel: t('activate'), cancelLabel: t('cancel'), danger: false });
    if (!accepted) return;
    setBusyId(id);
    setActionMessage('');
    try {
      await adminApi.post(`/admin/payment-requests/${id}/approve`, {});
      await load();
      setActionMessage(t('activationSuccess'));
    } catch (error) {
      setActionMessage(localizeApiError(error, t, locale, 'activationFailed'));
    } finally {
      setBusyId(null);
    }
  };
  const reject = async (id) => {
    const note = await askText({ title: t('reject'), message: t('rejectReason'), placeholder: t('rejectReason'), confirmLabel: t('reject'), cancelLabel: t('cancel') });
    if (note === null) return;
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
    const accepted = await confirm({ title: t('deleteRequest'), message: t('deleteRequestConfirm'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true });
    if (!accepted) return;
    await adminApi.delete(`/admin/payment-requests/${id}`);
    load();
  };

  return (
    <>
      {confirmDialog}
      {textDialog}
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

      <div className="relative mb-3"><input className="input text-sm pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('requestSearchPlaceholder')} aria-label={t('requestSearchLabel')} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/35">⌕</span></div>
      <div className="space-y-3">
        {filteredRequests.map((r) => (
          <div key={r.id} className="card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {r.receipt_image ? (
                <button onClick={() => setViewReceipt(r.receipt_image)}>
                  <img src={r.receipt_image} alt={t('receiptAlt')} className="w-14 h-14 object-cover rounded-lg border border-line" />
                </button>
              ) : (
                <div className="w-14 h-14 rounded-lg border border-dashed border-line flex items-center justify-center text-[10px] text-ink/40 text-center">{t('noReceipt')}</div>
              )}
              <div>
                <p className="font-bold">{r.full_name} <span className="text-ink/50 text-xs">({r.email})</span></p>
                <p className="text-sm text-ink/70">{t('plan')}: {r.plan_title || planLabel(t, r.plan)} {!r.plan_title && r.plan && !PLAN_LABELS[r.plan] && <small>({t('rawPlan')}: {r.plan})</small>} · {t('amountLabel')}: <strong>{r.amount_omr} {t('currencyOMR')}</strong>{r.original_amount_omr && Number(r.original_amount_omr) !== Number(r.amount_omr) ? ` · ${t('originalPrice')}: ${r.original_amount_omr} ${t('currencyOMR')}` : ''}</p>
                {r.offer_id && <p className="text-xs text-primary/70">{t('offerLabel')}: {r.offer_id}</p>}
                {r.student_count !== null && r.student_count !== undefined && <p className="text-xs text-ink/60">{t('pricingRequestBreakdown', '', { count: r.student_count, included: r.included_students ?? '—', extra: r.extra_students ?? 0, unit: omrWithEquivalent(r.extra_student_price_omr, locale), surcharge: omrWithEquivalent(r.extra_amount_omr, locale) })}</p>}
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
                  <button className="text-primary text-xs" onClick={() => restore(r.id)}>{t('restore')}</button>
                  <button className="text-danger text-xs" onClick={() => remove(r.id)}>{t('deletePermanently')}</button>
                </>
              ) : (
                <button className="text-ink/50 text-xs" onClick={() => archive(r.id)}>{t('archive')}</button>
              )}
            </div>
          </div>
        ))}
        {filteredRequests.length === 0 && <p className="text-ink/50 text-sm">{requests.length ? t('noSearchResults') : t('noRequests')}</p>}
      </div>

      {viewReceipt && (
        <div className="fixed inset-0 bg-ink/70 z-50 flex items-center justify-center p-4" onClick={() => setViewReceipt(null)}>
          <img src={viewReceipt} alt={t('receiptAlt')} className="max-h-[85vh] max-w-full rounded-lg" />
        </div>
      )}
    </>
  );
}

function SubscriptionConfig() {
  const { t, locale } = useLocale();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [config, setConfig] = useState(() => ({ trial_days: 14, plans: [], plan_definitions: DEFAULT_PLAN_EDITOR, offers: [] }));
  const [planDrafts, setPlanDrafts] = useState(() => localizedDefaultEditorPlans(DEFAULT_PLAN_EDITOR, t));
  const [trialDays, setTrialDays] = useState(14);
  const [offer, setOffer] = useState(EMPTY_OFFER);
  const [editingOfferId, setEditingOfferId] = useState(null);
  const [savedMessage, setSavedMessage] = useState('');
  const [planSavedMessage, setPlanSavedMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await adminApi.get('/admin/subscription-config');
    setConfig(data);
    setPlanDrafts(localizedDefaultEditorPlans(data.plan_definitions, t));
    setTrialDays(data.trial_days);
  };
  useEffect(() => { load(); }, [locale]);

  const saveTrial = async () => {
    setBusy(true);
    try { await adminApi.patch('/admin/subscription-config', { trial_days: Number(trialDays) }); await load(); } finally { setBusy(false); }
  };
  const updatePlan = (id, field, value) => setPlanDrafts((current) => current.map((plan) => plan.id === id ? { ...plan, [field]: value } : plan));
  const savePlans = async () => {
    setBusy(true);
    setPlanSavedMessage('');
    try {
      const payload = planDrafts.map((plan) => {
        const original = (config.plan_definitions || []).find((item) => item.id === plan.id) || DEFAULT_PLAN_EDITOR.find((item) => item.id === plan.id);
        const restored = restoreUnchangedDefaultEditorFields(plan, original, t);
        return {
          ...restored,
          base_price_omr: Number(restored.base_price_omr),
          duration_days: restored.duration_days === '' || restored.duration_days === null ? null : Number(restored.duration_days),
          features: Array.isArray(restored.features) ? restored.features : [],
        };
      });
      const { data } = await adminApi.patch('/admin/subscription-config', { plan_definitions: payload });
      setPlanDrafts(data.plan_definitions || payload);
      setPlanSavedMessage(t('basePlansSaved'));
      await load();
    } catch (error) {
      setPlanSavedMessage(localizeApiError(error, t, locale, 'basePlansSaveFailed'));
    } finally { setBusy(false); }
  };
  const saveOffer = async (event) => {
    event.preventDefault();
    setBusy(true);
    setSavedMessage('');
    try {
      const payload = offerPayload(offer);
      if (!payload.title) {
        setSavedMessage(t('offerTitleRequired'));
        return;
      }
      if (!Number.isFinite(payload.original_price_omr) || !Number.isFinite(payload.offer_price_omr) || payload.original_price_omr <= 0 || payload.offer_price_omr <= 0 || payload.offer_price_omr > payload.original_price_omr) {
        setSavedMessage(t('offerPriceValidation'));
        return;
      }
      if (payload.starts_at && payload.ends_at && new Date(payload.ends_at) < new Date(payload.starts_at)) {
        setSavedMessage(t('offerDateValidation'));
        return;
      }
      if (editingOfferId) await adminApi.patch(`/admin/offers/${editingOfferId}`, payload);
      else await adminApi.post('/admin/offers', payload);
      setOffer(EMPTY_OFFER);
      setEditingOfferId(null);
      setSavedMessage(editingOfferId ? t('offerEditedSaved') : t('offerAddedSaved'));
      await load();
      window.setTimeout(() => setSavedMessage(''), 3500);
    } catch (error) {
      setSavedMessage(localizeApiError(error, t, locale, 'offerSaveFailed'));
    } finally { setBusy(false); }
  };
  const startEditOffer = (item) => {
    setEditingOfferId(item.id);
    setOffer({ plan: item.plan, title: item.title || '', description: item.description || '', original_price_omr: item.original_price_omr, offer_price_omr: item.offer_price_omr, starts_at: toDateTimeLocal(item.starts_at), ends_at: toDateTimeLocal(item.ends_at), enabled: Boolean(item.enabled) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const cancelEditOffer = () => { setEditingOfferId(null); setOffer(EMPTY_OFFER); };
  const toggleOffer = async (item) => { setBusy(true); try { await adminApi.patch(`/admin/offers/${item.id}`, { enabled: !item.enabled }); await load(); } finally { setBusy(false); } };
  const removeOffer = async (id) => { const accepted = await confirm({ title: t('deleteOffer'), message: t('deleteOfferConfirm'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true }); if (!accepted) return; await adminApi.delete(`/admin/offers/${id}`); load(); };

  return <div className="admin-subscription-config">
    {confirmDialog}
    <div className="admin-config-card admin-config-card--plans">
      <div className="admin-config-card__heading"><div><span className="admin-config-eyebrow">{t('baseProduct')}</span><h3>{t('editBasePlans')}</h3><p>{t('basePlansDescription')}</p></div><span className="admin-config-icon">◇</span></div>
      <div className="admin-base-plans-grid">{planDrafts.map((plan) => <article key={plan.id} className={`admin-base-plan-editor ${plan.highlight ? 'is-featured' : ''}`}>
        <div className="admin-base-plan-editor__top"><span className="admin-plan-pill">{planLabel(t, plan.id)}</span><label className="admin-featured-toggle"><input type="checkbox" checked={Boolean(plan.highlight)} onChange={(e) => updatePlan(plan.id, 'highlight', e.target.checked)} /><span>{t('featuredPlan')}</span></label></div>
        <label className="label">{t('planName')}<input className="input" value={plan.title} onChange={(e) => updatePlan(plan.id, 'title', e.target.value)} /></label>
        <div className="admin-plan-editor-row"><label className="label">{t('basePrice')}<input className="input" type="number" min="0.01" step="0.01" value={plan.base_price_omr} onChange={(e) => updatePlan(plan.id, 'base_price_omr', e.target.value)} /></label><label className="label">{t('planDuration')}<input className="input" type="text" value={plan.duration_days === null ? t('unlimited') : `${plan.duration_days} ${t('daysUnit')}`} readOnly aria-readonly="true" /><small className="admin-label-hint">{t('fixedDurationHint')}</small></label></div>
        <label className="label">{t('shortDescription')}<input className="input" value={plan.note || ''} onChange={(e) => updatePlan(plan.id, 'note', e.target.value)} /></label>
        <label className="label">{t('planFeatures')} <span className="admin-label-hint">{t('oneFeaturePerLine')}</span><textarea className="input" rows={4} value={(plan.features || []).join('\n')} onChange={(e) => updatePlan(plan.id, 'features', e.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} /></label>
      </article>)}</div>
      <div className="admin-plan-editor-actions"><button className="btn-primary" type="button" disabled={busy} onClick={savePlans}>{busy ? t('saving') : t('saveBasePlans')}</button>{planSavedMessage && <span className={`save-feedback ${planSavedMessage === t('basePlansSaved') ? 'save-feedback--success' : 'save-feedback--error'}`}>{planSavedMessage}</span>}</div>
    </div>
    <div className="admin-config-card admin-config-card--trial"><div className="admin-config-icon">◷</div><div className="flex-1"><span className="admin-config-eyebrow">{t('newAccountsPolicy')}</span><h3>{t('trialDuration')}</h3><p>{t('trialDurationDescription')}</p></div><div className="admin-inline-edit"><input className="input" type="number" min="1" max="365" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} /><span>{t('daysUnit')}</span><button className="btn-primary" disabled={busy} onClick={saveTrial}>{t('saveDuration')}</button></div></div>
    <div className="admin-config-card admin-config-card--offer"><div className="admin-config-card__heading"><div><span className="admin-config-eyebrow">{editingOfferId ? t('editSavedOffer') : t('createNewOffer')}</span><h3>{editingOfferId ? t('editOfferDetails') : t('addOfferForTeachers')}</h3><p>{t('offerCardDescription')}</p></div>{editingOfferId && <button className="btn-secondary text-sm" type="button" onClick={cancelEditOffer}>{t('cancelOfferEdit')}</button>}</div><form onSubmit={saveOffer} className="offer-editor-grid"><label className="label">{t('plan')}<select className="input" value={offer.plan} onChange={(e) => setOffer({ ...offer, plan: e.target.value })}>{Object.keys(PLAN_LABELS).filter((id) => id !== 'trial').map((id) => <option key={id} value={id}>{planLabel(t, id)}</option>)}</select></label><label className="label">{t('offerTitle')}<input className="input" placeholder={t('offerTitlePlaceholder')} value={offer.title} onChange={(e) => setOffer({ ...offer, title: e.target.value })} required /></label><label className="label offer-editor-grid__wide">{t('offerDescriptionLabel')}<input className="input" placeholder={t('offerDescriptionPlaceholder')} value={offer.description} onChange={(e) => setOffer({ ...offer, description: e.target.value })} /></label><label className="label">{t('originalPrice')}<input className="input" type="number" min="0.01" step="0.01" value={offer.original_price_omr} onChange={(e) => setOffer({ ...offer, original_price_omr: e.target.value })} required /></label><label className="label">{t('offerPrice')}<input className="input" type="number" min="0.01" step="0.01" value={offer.offer_price_omr} onChange={(e) => setOffer({ ...offer, offer_price_omr: e.target.value })} required /></label><label className="label">{t('startsAt')}<input className="input" type="datetime-local" value={offer.starts_at} onChange={(e) => setOffer({ ...offer, starts_at: e.target.value })} /></label><label className="label">{t('endsAt')}<input className="input" type="datetime-local" value={offer.ends_at} onChange={(e) => setOffer({ ...offer, ends_at: e.target.value })} /></label><label className="offer-enabled-toggle"><input type="checkbox" checked={offer.enabled} onChange={(e) => setOffer({ ...offer, enabled: e.target.checked })} /><span>{t('showOfferImmediately')}</span></label><div className="offer-editor-actions"><button className="btn-primary" disabled={busy} type="submit">{busy ? t('saving') : editingOfferId ? t('saveOfferEdit') : t('addOffer')}</button>{savedMessage && <span className="save-feedback save-feedback--success">{savedMessage}</span>}</div></form></div>
    <div className="admin-offers-list"><div className="admin-config-card__heading"><div><span className="admin-config-eyebrow">{t('offersLibrary')}</span><h3>{t('savedOffers')}</h3><p>{t('savedOffersDescription')}</p></div><span className="admin-offer-count">{t('offersCount', '', { count: config.offers?.length || 0 })}</span></div><div className="admin-offers-grid">{(config.offers || []).map((item) => <article key={item.id} className={`admin-offer-row ${item.enabled ? 'is-enabled' : 'is-disabled'}`}><div className="admin-offer-row__status"><span className="admin-offer-status-dot" />{item.enabled ? t('offerActive') : t('offerPaused')}</div><div className="admin-offer-row__body"><div className="flex items-center gap-2 flex-wrap"><h4>{item.title || t('offerNoTitle')}</h4><span className="admin-plan-pill">{planLabel(t, item.plan)}</span></div><p>{item.description || t('offerNoDescription')}</p><div className="admin-offer-row__meta"><strong><del>{item.original_price_omr} {t('currencyOMR')}</del> {item.offer_price_omr} {t('currencyOMR')}</strong><span>{item.starts_at ? `${t('from')} ${new Date(item.starts_at).toLocaleDateString(locale === 'ar' ? 'ar' : 'en-US')}` : t('instant')} · {item.ends_at ? `${t('until')} ${new Date(item.ends_at).toLocaleDateString(locale === 'ar' ? 'ar' : 'en-US')}` : t('noExpiry')}</span></div></div><div className="admin-offer-row__actions"><button className="text-primary text-xs" disabled={busy} onClick={() => startEditOffer(item)}>{t('edit')}</button><button className="text-ink/60 text-xs" disabled={busy} onClick={() => toggleOffer(item)}>{item.enabled ? t('pause') : t('enable')}</button><button className="text-danger text-xs" disabled={busy} onClick={() => removeOffer(item.id)}>{t('delete')}</button></div></article>)}{config.offers?.length === 0 && <div className="admin-empty-offers">{t('noSavedOffers')}</div>}</div></div>
  </div>;
}

function StudentLimitsConfig() {
  const { t, locale } = useLocale();
  const [plans, setPlans] = useState(() => localizedDefaultEditorPlans(DEFAULT_PLAN_EDITOR, t).map((plan) => ({ id: plan.id, title: plan.title, included_students: plan.included_students, extra_student_price_omr: plan.extra_student_price_omr })));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    try {
      const { data } = await adminApi.get('/admin/student-limits');
      if (Array.isArray(data.plans)) setPlans(data.plans.map((plan) => localizeDefaultEditorPlan(plan, t)));
    } catch (error) {
      setMessage(localizeApiError(error, t, locale, 'studentLimitSaveFailed'));
    }
  };
  useEffect(() => { load(); }, [locale]);

  const update = (id, field, value) => setPlans((current) => current.map((plan) => plan.id === id ? { ...plan, [field]: value } : plan));
  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      const payload = plans.map((plan) => ({ id: plan.id, included_students: Number(plan.included_students), extra_student_price_omr: Number(plan.extra_student_price_omr) }));
      const { data } = await adminApi.patch('/admin/student-limits', { plans: payload });
      setPlans(data.plans || plans);
      setMessage(t('studentLimitSaved'));
    } catch (error) {
      setMessage(localizeApiError(error, t, locale, 'studentLimitSaveFailed'));
    } finally { setBusy(false); }
  };

  return <section className="admin-student-limits">
    <div className="admin-config-card admin-config-card--student-limits">
      <div className="admin-config-card__heading"><div><span className="admin-config-eyebrow">{t('studentLimits')}</span><h3>{t('studentLimitsTitle')}</h3><p>{t('studentLimitsDescription')}</p></div><span className="admin-config-icon">#</span></div>
      <div className="student-limits-grid">
        {plans.map((plan) => <article key={plan.id} className="student-limit-card">
          <div className="student-limit-card__heading"><strong>{plan.title || planLabel(t, plan.id)}</strong><span>{plan.id}</span></div>
          <label className="label">{t('includedStudents')}<input className="input" type="number" min="1" max="100000" step="1" value={plan.included_students ?? ''} onChange={(event) => update(plan.id, 'included_students', event.target.value)} /></label>
          <label className="label">{t('extraStudentPrice')}<div className="student-limit-price-input"><input className="input" type="number" min="0" max="1000" step="0.001" value={plan.extra_student_price_omr ?? ''} onChange={(event) => update(plan.id, 'extra_student_price_omr', event.target.value)} /><span>{locale === 'ar' ? 'ر.ع / طالب' : 'OMR / student'}</span></div></label>
          <p className="student-limit-card__hint">{t('extraStudentHelp')}</p>
        </article>)}
      </div>
      <div className="admin-plan-editor-actions"><button className="btn-primary" type="button" disabled={busy} onClick={save}>{busy ? t('saving') : t('saveChanges')}</button>{message && <span className={`save-feedback ${message === t('studentLimitSaved') ? 'save-feedback--success' : 'save-feedback--error'}`}>{message}</span>}</div>
    </div>
  </section>;
}

function PasswordResetRequests() {
  const { t, locale } = useLocale();
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
    {generated && <div className="card p-4 border-2 border-primary"><p className="font-bold text-primary mb-1">{t('resetLinkFor', '', { email: generated.request?.email })}</p><p className="text-xs text-ink/60 mb-2">{t('resetLinkCopiedHelp')}</p><div className="flex gap-2"><input className="input text-xs flex-1" readOnly value={generated.reset_link} onFocus={(e) => e.target.select()} /><button className="btn-secondary text-xs" onClick={() => navigator.clipboard?.writeText(generated.reset_link)}>{t('copyLink')}</button></div></div>}
    {requests.map((request) => <div key={request.id} className="card p-4 flex flex-wrap items-center justify-between gap-3"><div><p className="font-bold">{request.full_name}</p><p className="text-sm text-ink/60">{request.email}</p><p className="text-xs text-ink/40">{new Date(request.created_at).toLocaleString(locale === 'ar' ? 'ar' : 'en-US')}</p></div><div className="flex gap-2"><button className="btn-primary text-xs" onClick={() => generate(request.id)}>{t('createResetLink')}</button><button className="text-ink/50 text-xs" onClick={() => close(request.id)}>{t('close')}</button></div></div>)}
    {requests.length === 0 && <div className="card p-6 text-sm text-ink/50">{t('noPendingPasswordRequests')}</div>}
  </div>;
}

function TeachersList({ onMessage }) {
  const { t, locale } = useLocale();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [teachers, setTeachers] = useState([]);
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [actionBusy, setActionBusy] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  useEffect(() => {
    let mounted = true;
    setLoadError('');
    adminApi.get('/admin/teachers')
      .then(({ data }) => { if (mounted) setTeachers(Array.isArray(data.teachers) ? data.teachers : []); })
      .catch((error) => {
        if (!mounted) return;
        setTeachers([]);
        setLoadError(localizeApiError(error, t, locale, 'loadTeachersFailed'));
      });
    return () => { mounted = false; };
  }, [locale, reloadKey]);
  const updateAccountStatus = async (teacher, status) => {
    const key = teacher.id + ':' + status;
    setActionBusy(key);
    setActionMessage('');
    try {
      const { data } = await adminApi.patch('/admin/teachers/' + teacher.id + '/account-status', { status, note: teacher.account_note || '' });
      const next = data.account_status;
      setTeachers((current) => current.map((item) => item.id === teacher.id ? { ...item, account_status: next.status, account_note: next.note } : item));
      setActionMessage(t('accountStatusSaved'));
    } catch (error) {
      setActionMessage(localizeApiError(error, t, locale, 'accountStatusSaveFailed'));
    } finally {
      setActionBusy('');
    }
  };
  const deleteTeacher = async (teacher) => {
    const accepted = await confirm({ title: t('deleteAccount'), message: t('deleteAccountConfirm'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true });
    if (!accepted) return;
    const key = teacher.id + ':delete';
    setActionBusy(key);
    setActionMessage('');
    try {
      await adminApi.delete('/admin/teachers/' + teacher.id);
      setTeachers((current) => current.filter((item) => item.id !== teacher.id));
      setActionMessage(t('accountDeleted'));
    } catch (error) {
      setActionMessage(localizeApiError(error, t, locale, 'accountStatusSaveFailed'));
    } finally {
      setActionBusy('');
    }
  };
  const filteredTeachers = teachers.filter((teacher) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [teacher.full_name, teacher.email, teacher.school_name, teacher.plan, teacher.plan_title, teacher.account_status].some((value) => String(value || '').toLowerCase().includes(term));
  });
  const statusLabel = (status) => ({ active: t('statusActive'), expired: t('statusExpired'), pending: t('statusPending'), approved: t('statusApproved') }[status] || status || '—');
  return (
    <div>
      {confirmDialog}
      <div className="relative mb-3"><input className="input text-sm pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('teacherSearchPlaceholder')} aria-label={t('teacherSearchLabel')} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/35">⌕</span></div>
      {loadError && <div className="admin-list-error" role="alert"><span>{loadError}</span><button type="button" onClick={() => setReloadKey((value) => value + 1)}>{t('retry')}</button></div>}
      {actionMessage && <div className="admin-action-feedback" role="status">{actionMessage}</div>}
      <div className="card table-scroll-sticky">
        <table className="w-full text-sm table-head-sticky">
          <thead className="bg-surface"><tr>
            <th className="text-right px-4 py-2">{t('teacherName')}</th>
            <th className="text-right px-4 py-2">{t('email')}</th>
            <th className="text-right px-4 py-2">{t('plan')}</th>
            <th className="text-right px-4 py-2">{t('status')}</th>
            <th className="text-right px-4 py-2">{t('accountStatus')}</th>
            <th className="text-right px-4 py-2">{t('adminActions')}</th>
          </tr></thead>
          <tbody>
            {filteredTeachers.map((teacher) => {
              const accountStatus = teacher.account_status || 'active';
              return <tr className="border-t border-line" key={teacher.id}>
                <td className="px-4 py-2"><strong>{teacher.full_name}</strong>{teacher.school_name && <small className="block text-xs text-ink/45">{teacher.school_name}</small>}</td>
                <td className="px-4 py-2 text-ink/60">{teacher.email}</td>
                <td className="px-4 py-2">{teacher.plan_title || planLabel(t, teacher.plan) || '—'}</td>
                <td className="px-4 py-2">{statusLabel(teacher.status)}</td>
                <td className="px-4 py-2"><span className={`admin-account-status admin-account-status--${accountStatus}`}>{t({ active: 'accountStatusActive', disabled: 'accountStatusDisabled', banned: 'accountStatusBanned' }[accountStatus] || 'accountStatusActive')}</span></td>
                <td className="px-4 py-2"><div className="flex flex-wrap gap-2 justify-end">
                  <button className="text-primary text-xs" onClick={() => onMessage(teacher)}>{t('messageTeacher')}</button>
                  {accountStatus === 'active' ? <><button className="text-accent text-xs" disabled={Boolean(actionBusy)} onClick={() => updateAccountStatus(teacher, 'disabled')}>{t('disableAccount')}</button><button className="text-danger text-xs" disabled={Boolean(actionBusy)} onClick={() => updateAccountStatus(teacher, 'banned')}>{t('banAccount')}</button></> : <button className="text-primary text-xs" disabled={Boolean(actionBusy)} onClick={() => updateAccountStatus(teacher, 'active')}>{t('restoreAccount')}</button>}
                  <button className="text-danger text-xs font-bold" disabled={Boolean(actionBusy)} onClick={() => deleteTeacher(teacher)}>× {t('deleteAccount')}</button>
                </div></td>
              </tr>;
            })}
          </tbody>
        </table>
        {filteredTeachers.length === 0 && <p className="p-4 text-sm text-ink/50">{teachers.length ? t('noMatchingTeachers') : t('noTeachersYet')}</p>}
      </div>
    </div>
  );
}
function RestrictionsTab() {
  const { t, locale } = useLocale();
  const [draft, setDraft] = useState({ enabled: false, apply_when_expired: true, blocked_features: [], note: '' });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    adminApi.get('/admin/subscription-restrictions')
      .then(({ data }) => {
        if (!mounted) return;
        setDraft({ enabled: Boolean(data.restrictions?.enabled), apply_when_expired: data.restrictions?.apply_when_expired !== false, blocked_features: [...(data.restrictions?.blocked_features || [])], note: data.restrictions?.note || '' });
        setLoaded(true);
      })
      .catch((requestError) => { if (mounted) setError(localizeApiError(requestError, t, locale, 'loadGlobalPolicyFailed')); })
      .finally(() => { if (mounted) setLoaded(true); });
    return () => { mounted = false; };
  }, [locale]);
  const toggleFeature = (feature) => setDraft((current) => ({ ...current, blocked_features: current.blocked_features.includes(feature) ? current.blocked_features.filter((item) => item !== feature) : [...current.blocked_features, feature] }));
  const save = async () => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const { data } = await adminApi.patch('/admin/subscription-restrictions', draft);
      setDraft((current) => ({ ...current, ...(data.restrictions || {}) }));
      setMessage(t('restrictionSaved'));
    } catch (requestError) {
      setError(localizeApiError(requestError, t, locale, 'restrictionSaveFailed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="admin-restrictions-workspace">
      <div className="admin-restrictions-workspace__intro">
        <div><span className="admin-config-eyebrow">{t('globalPolicyLabel')}</span><h2>{t('expiryRestrictions')}</h2><p>{t('expiryRestrictionsDescription')}</p></div>
        <span className="admin-restrictions-workspace__count">{t('allTeachersLabel')}</span>
      </div>
      <section className="admin-restrictions-panel admin-restrictions-panel--dedicated">
        <div className="admin-restrictions-panel__heading"><div><strong>{t('configureExpiryPolicy')}</strong><small>{t('expiryPolicyHint')}</small></div></div>
        {error && <div className="admin-list-error" role="alert"><span>{error}</span></div>}
        <label className="admin-restriction-toggle"><input type="checkbox" checked={Boolean(draft.enabled)} disabled={!loaded} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span>{t('enableGlobalRestriction')}</span></label>
        <label className="admin-restriction-toggle"><input type="checkbox" checked={draft.apply_when_expired !== false} disabled={!loaded} onChange={(event) => setDraft({ ...draft, apply_when_expired: event.target.checked })} /><span>{t('applyRestrictionsOnExpiry')}</span></label>
        <p className="admin-restrictions-label">{t('blockedFeatures')}</p>
        <div className="admin-restrictions-grid">{RESTRICTION_FEATURE_OPTIONS.map((feature) => <label key={feature.id} className="admin-restriction-option"><input type="checkbox" disabled={!loaded} checked={draft.blocked_features.includes(feature.id)} onChange={() => toggleFeature(feature.id)} /><span>{t(feature.key)}</span></label>)}</div>
        <label className="label">{t('restrictionNote')}<textarea className="input" rows="3" value={draft.note || ''} disabled={!loaded} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
        <div className="flex items-center gap-3"><button type="button" className="btn-primary text-xs" disabled={!loaded || busy} onClick={save}>{busy ? '...' : t('saveRestrictions')}</button>{message && <span className="text-xs text-primary">{message}</span>}</div>
      </section>
    </div>
  );
}
function BroadcastComposer({ onSent }) {
  const { t } = useLocale();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    const accepted = await confirm({ title: t('broadcastTitle'), message: t('broadcastConfirm'), confirmLabel: t('send'), cancelLabel: t('cancel'), danger: false });
    if (!accepted) return;
    setBusy(true);
    try {
      const { data } = await adminApi.post('/admin/broadcast', { text });
      setResult(t('broadcastSent', '', { count: data.sentTo }));
      setText('');
      onSent?.();
      setTimeout(() => setResult(''), 3000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-3 mb-3">
      {confirmDialog}
      {!open ? (
        <button className="text-primary text-sm font-medium" onClick={() => setOpen(true)}>📢 {t('broadcastOpen')}</button>
      ) : (
        <form onSubmit={send} className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">{t('broadcastOpen')}</span>
            <button type="button" className="text-ink/40 text-xs" onClick={() => setOpen(false)}>{t('broadcastClose')}</button>
          </div>
          <textarea className="input text-sm" rows={3} placeholder={t('broadcastPlaceholder')} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex items-center gap-2">
            <button className="btn-primary text-sm" disabled={busy} type="submit">{busy ? '...' : t('broadcastSendAll')}</button>
            {result && <span className="text-primary text-xs">{result}</span>}
          </div>
        </form>
      )}
    </div>
  );
}

function ChatPanel({ initialTeacher }) {
  const { t, locale } = useLocale();
  const [conversations, setConversations] = useState([]);
  const [presence, setPresence] = useState({});
  const [active, setActive] = useState(initialTeacher || null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const socketRef = useRef(null);
  const scrollRef = useRef(null);
  const loadConversations = async () => {
    const { data } = await adminApi.get('/admin/conversations');
    setConversations(Array.isArray(data.conversations) ? data.conversations : []);
  };
  useEffect(() => {
    void loadConversations();
    const token = localStorage.getItem('educore_admin_token');
    if (!token) return undefined;
    const onReconnect = loadConversations;
    const onError = (err) => console.warn('Admin chat connection error', err.message);
    const onPresenceSnapshot = ({ teacher_ids }) => {
      const next = {};
      (Array.isArray(teacher_ids) ? teacher_ids : []).forEach((teacherId) => { next[teacherId] = true; });
      setPresence(next);
    };
    const onPresence = ({ teacher_id, online }) => {
      if (!teacher_id) return;
      setPresence((current) => ({ ...current, [teacher_id]: Boolean(online) }));
    };
    const onNewMessage = (msg) => {
      setConversations((prev) => {
        const existing = prev.find((conversation) => conversation.teacher_id === msg.teacher_id);
        if (!existing) {
          void loadConversations();
          return prev;
        }
        const updated = { ...existing, last_message: msg.text, last_message_at: msg.created_at, unread_count: msg.sender === 'teacher' ? Number(existing.unread_count || 0) + 1 : existing.unread_count };
        return [updated, ...prev.filter((conversation) => conversation.teacher_id !== msg.teacher_id)];
      });
      setActive((current) => {
        if (current && current.teacher_id === msg.teacher_id) setMessages((prev) => mergeChatMessage(prev, msg));
        return current;
      });
    };
    const socket = connectSocket(token, { onReconnect, onError });
    socketRef.current = socket;
    socket.on('teacher_presence_snapshot', onPresenceSnapshot);
    socket.on('teacher_presence', onPresence);
    socket.on('new_message', onNewMessage);
    return () => {
      socket.off('teacher_presence_snapshot', onPresenceSnapshot);
      socket.off('teacher_presence', onPresence);
      socket.off('new_message', onNewMessage);
      releaseSocket(socket, { onReconnect, onError });
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
    setConversations((prev) => prev.map((conversation) => conversation.teacher_id === active.teacher_id ? { ...conversation, unread_count: 0 } : conversation));
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
    const optimistic = { id: `local-${clientMessageId}`, client_message_id: clientMessageId, teacher_id: active.teacher_id, sender: 'admin', text: draft, created_at: new Date().toISOString() };
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
  const orderedConversations = [...conversations].sort((a, b) => {
    const onlineDelta = Number(Boolean(presence[b.teacher_id])) - Number(Boolean(presence[a.teacher_id]));
    if (onlineDelta) return onlineDelta;
    if (a.last_message_at && b.last_message_at) return String(b.last_message_at).localeCompare(String(a.last_message_at));
    if (a.last_message_at) return -1;
    if (b.last_message_at) return 1;
    return String(a.full_name || '').localeCompare(String(b.full_name || ''));
  });
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-3"><BroadcastComposer onSent={loadConversations} /></div>
      <div className="card admin-chat-directory">
        <div className="admin-chat-directory__heading"><strong>{t('chatTeachers')}</strong><span>{conversations.length}</span></div>
        <div className="admin-chat-directory__list">
          {orderedConversations.map((c) => {
            const online = Boolean(presence[c.teacher_id]);
            return <button key={c.teacher_id} onClick={() => setActive(c)} className={`admin-chat-teacher ${active?.teacher_id === c.teacher_id ? 'is-active' : ''}`}>
              <div className="flex items-center justify-between gap-2"><span className="font-medium text-sm truncate">{c.full_name}</span><span className={`admin-presence ${online ? 'is-online' : 'is-offline'}`}><i />{online ? t('adminOnline') : t('adminOffline')}</span></div>
              <div className="flex items-center justify-between gap-2"><p className="text-xs text-ink/50 truncate">{c.last_message || t('adminNoMessages')}</p>{c.unread_count > 0 && <span className="bg-danger text-white text-[10px] rounded-full px-1.5 py-0.5">{c.unread_count}</span>}</div>
            </button>;
          })}
          {orderedConversations.length === 0 && <p className="text-ink/50 text-sm p-4">{t('noTeachersYet')}</p>}
        </div>
      </div>
      <div className="card md:col-span-2 flex flex-col overflow-hidden" style={{ height: 500 }}>
        {!active ? <p className="text-ink/50 text-sm p-6">{t('chooseTeacher')}</p> : <>
          <div className="px-4 py-3 border-b border-line font-bold text-sm flex items-center justify-between gap-2"><span>{active.full_name}</span><span className={`admin-presence ${presence[active.teacher_id] ? 'is-online' : 'is-offline'}`}><i />{presence[active.teacher_id] ? t('adminOnline') : t('adminOffline')}</span></div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-surface">{messages.map((m) => <div key={m.id} className={`max-w-[75%] px-3 py-2 rounded-xl2 text-sm ${m.sender === 'admin' ? 'bg-primary text-white mr-auto' : 'bg-white border border-line ml-auto'}`}>{m.text}<div className={`text-[10px] mt-1 ${m.sender === 'admin' ? 'text-white/70' : 'text-ink/40'}`}>{new Date(m.created_at).toLocaleTimeString(locale === 'ar' ? 'ar' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</div></div>)}</div>
          <form onSubmit={send} className="p-2 border-t border-line flex gap-2"><input className="input text-sm flex-1" placeholder={t('replyPlaceholder')} value={text} onChange={(e) => setText(e.target.value)} /><button className="btn-primary text-sm px-3" type="submit">{t('send')}</button></form>
        </>}
      </div>
    </div>
  );
}
export default function AdminDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('requests');
  const [chatTarget, setChatTarget] = useState(null);
  const { t, locale } = useLocale();

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
        <header className="admin-page-hero"><div className="admin-page-hero__brand"><div className="brand-mark brand-mark--image"><img src="/educore-logo.webp" alt="EduCore" /></div><div><span className="admin-eyebrow">{t('adminCenter')}</span><h1>{t('adminDashboard')}</h1><p>{t('adminDescription')}</p></div></div><div className="admin-hero-stamp"><span>ADMIN</span><small>EduCore control room</small></div><button className="btn-secondary text-sm admin-logout" onClick={logout}>{t('accountLogout')}</button></header>
        <nav className="admin-tabs" aria-label={t('adminSections')}>
          <button onClick={() => setTab('requests')} className={`admin-tab ${tab === 'requests' ? 'is-active' : ''}`}><span>01</span>{t('activationRequests')}</button>
          <button onClick={() => setTab('teachers')} className={`admin-tab ${tab === 'teachers' ? 'is-active' : ''}`}><span>02</span>{t('allTeachers')}</button>
          <button onClick={() => setTab('restrictions')} className={`admin-tab ${tab === 'restrictions' ? 'is-active' : ''}`}><span>03</span>{t('expiryRestrictions')}</button>
          <button onClick={() => setTab('subscriptions')} className={`admin-tab ${tab === 'subscriptions' ? 'is-active' : ''}`}><span>04</span>{t('subscriptionOffers')}</button>
          <button onClick={() => setTab('studentLimits')} className={`admin-tab ${tab === 'studentLimits' ? 'is-active' : ''}`}><span>05</span>{t('studentLimits')}</button>
          <button onClick={() => setTab('payment')} className={`admin-tab ${tab === 'payment' ? 'is-active' : ''}`}><span>06</span>{t('paymentSettings')}</button>
          <button onClick={() => setTab('announcement')} className={`admin-tab ${tab === 'announcement' ? 'is-active' : ''}`}><span>07</span>{t('urgentAnnouncement')}</button>
          <button onClick={() => setTab('notifications')} className={`admin-tab ${tab === 'notifications' ? 'is-active' : ''}`}><span>08</span>{t('notifications')}</button>
          <button onClick={() => setTab('passwords')} className={`admin-tab ${tab === 'passwords' ? 'is-active' : ''}`}><span>09</span>{t('passwordRequests')}</button>
          <button onClick={() => setTab('chat')} className={`admin-tab ${tab === 'chat' ? 'is-active' : ''}`}><span>10</span>{t('teacherChat')}</button>
        </nav>
      </div>
      <main className="admin-page-content">
        {tab === 'requests' && <PaymentRequests />}
        {tab === 'teachers' && <TeachersList onMessage={goToChat} />}
        {tab === 'restrictions' && <RestrictionsTab />}
        {tab === 'subscriptions' && <SubscriptionConfig />}
        {tab === 'studentLimits' && <StudentLimitsConfig />}
        {tab === 'payment' && <AdminPublicConfig section="payment" />}
        {tab === 'announcement' && <AdminPublicConfig section="announcement" />}
        {tab === 'notifications' && <AdminPublicConfig section="notifications" />}
        {tab === 'passwords' && <PasswordResetRequests />}
        {tab === 'chat' && <ChatPanel initialTeacher={chatTarget} />}
      </main>
    </div>
  );
}
