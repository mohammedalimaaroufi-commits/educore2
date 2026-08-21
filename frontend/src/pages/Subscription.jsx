import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext.jsx';
import { omrWithEquivalent } from '../constants.js';
import { resizeImageFile } from '../utils/image.js';
import { useLocale } from '../context/LocaleContext.jsx';

const FALLBACK_PLANS = [
  { id: '6_months', title: 'باقة 6 أشهر', base_price_omr: 4, price_omr: 4, original_price_omr: 4, duration_days: 182, note: 'وصول كامل لمدة نصف عام', features: ['دفتر درجات كامل', 'الحضور والسلوك', 'التحليلات والتقارير'] },
  { id: 'yearly', title: 'الباقة السنوية', highlight: true, base_price_omr: 7, price_omr: 7, original_price_omr: 7, duration_days: 365, note: 'الأكثر توفيرًا للعام الدراسي', features: ['كل أدوات EduCore', 'نسخ محلية ومزامنة', 'دعم فني مباشر'] },
  { id: 'lifetime', title: 'مدى الحياة', note: 'دفعة واحدة، وصول دائم', base_price_omr: 18, price_omr: 18, original_price_omr: 18, duration_days: null, features: ['وصول دائم', 'كل التحديثات المستقبلية', 'أولوية في الدعم'] },
];
const STATUS_LABELS = { active: 'مفعّل', pending: 'قيد المراجعة', approved: 'مُفعّل ✓', rejected: 'مرفوض', expired: 'منتهي' };
const PLAN_LABELS = { trial: 'فترة تجريبية', '6_months': 'باقة 6 أشهر', yearly: 'الباقة السنوية', lifetime: 'مدى الحياة' };
const PLAN_ALIASES = { annual: 'yearly', year: 'yearly', '12_months': 'yearly', '6_month': '6_months', '6months': '6_months', '6-months': '6_months', '6 أشهر': '6_months', 'باقة 6 أشهر': '6_months', سنوية: 'yearly', 'الباقة السنوية': 'yearly', 'مدى الحياة': 'lifetime', 'فترة تجريبية': 'trial' };
function canonicalPlanForUi(value) {
  const raw = String(value || '').trim();
  return PLAN_LABELS[raw] ? raw : PLAN_ALIASES[raw] || PLAN_ALIASES[raw.toLowerCase()] || raw || 'trial';
}

function formatDate(iso, locale) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function planLabel(plan, t) {
  const canonical = canonicalPlanForUi(plan);
  return {
    trial: t('planTrial'),
    '6_months': t('planSixMonths'),
    yearly: t('planYearly'),
    lifetime: t('planLifetime'),
  }[canonical] || String(plan || t('planTrial'));
}

function statusLabel(status, t) {
  return {
    active: t('statusActive'),
    pending: t('statusPending'),
    approved: t('statusApproved'),
    rejected: t('statusRejected'),
    expired: t('statusExpired'),
  }[status] || status || t('statusActive');
}

function SubscriptionDetailsCard() {
  const { subscriptionInfo } = useAuth();
  const { t, locale } = useLocale();
  if (!subscriptionInfo) return null;
  const { plan, status, startDate, endDate, daysLeft, expired } = subscriptionInfo;
  const normalizedPlan = canonicalPlanForUi(plan);
  const isTrial = normalizedPlan === 'trial';
  const currentStatusLabel = expired ? t('statusExpired') : (statusLabel(status, t) || (isTrial ? t('statusActive') : t('statusUnknown')));
  return (
    <section className="subscription-current-card">
      <div className="subscription-current-card__heading"><div><span className="subscription-eyebrow">{t('currentAccount')}</span><h3>{t('currentSubscription')}</h3></div><span className={`subscription-status-badge ${expired ? 'is-expired' : status === 'active' ? 'is-active' : 'is-pending'}`}>{currentStatusLabel}</span></div>
      <div className="subscription-details-grid">
        <div><p>{t('plan')}</p><strong>{planLabel(normalizedPlan, t)}</strong></div>
        <div><p>{t('activatedAt')}</p><strong>{formatDate(startDate, locale)}</strong></div>
        <div><p>{t('expiresAt')}</p><strong>{endDate ? formatDate(endDate, locale) : isTrial ? t('trialDatePending') : t('planLifetime')}</strong></div>
        <div><p>{t('remaining')}</p><strong className={expired ? 'is-danger' : daysLeft !== null && daysLeft <= 4 ? 'is-warning' : 'is-good'}>{daysLeft === null ? (isTrial ? t('trialPending') : t('unlimited')) : expired ? t('statusExpired') : t('days', '', { count: daysLeft })}</strong></div>
      </div>
      {status !== 'active' && !expired && <p className="subscription-current-card__note">{t('currentStatusNote', '', { status: currentStatusLabel })}</p>}
    </section>
  );
}

export default function Subscription() {
  const { subscription, refreshMe } = useAuth();
  const { t, locale } = useLocale();
  const [plans, setPlans] = useState([]);
  const [phone, setPhone] = useState('');
  const [trialDays, setTrialDays] = useState(14);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [referenceNote, setReferenceNote] = useState('');
  const [receiptImage, setReceiptImage] = useState('');
  const [myRequests, setMyRequests] = useState([]);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const activationRef = useRef(null);

  const loadRequests = async () => {
    const { data } = await api.get('/auth/payment-requests');
    setMyRequests(data.requests || []);
  };

  useEffect(() => {
    api.get('/auth/plans').then(({ data }) => {
      setPlans((data.plans || []).map((plan) => ({ ...(FALLBACK_PLANS.find((item) => item.id === plan.id) || {}), ...plan })));
      setPhone(data.payment_phone || '');
      setTrialDays(Number(data.trial_days || 14));
    }).catch(() => setPlans(FALLBACK_PLANS));
    loadRequests().catch(() => setMyRequests([]));
  }, []);

  useEffect(() => {
    if (selectedPlan) activationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedPlan]);

  const selected = plans.find((plan) => plan.id === selectedPlan);
  const priceFor = (plan) => Number(plan?.price_omr ?? plan?.base_price_omr ?? 0);
  const originalPriceFor = (plan) => Number(plan?.original_price_omr ?? plan?.base_price_omr ?? priceFor(plan));

  const handleReceipt = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setReceiptImage(await resizeImageFile(file, 500, 0.7));
  };

  const submitRequest = async (e) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      await api.post('/auth/payment-requests', { plan: selected.id, offer_id: selected.offer?.id || null, reference_note: referenceNote, receipt_image: receiptImage });
      setSubmitted(true);
      setSelectedPlan(null);
      setReferenceNote('');
      setReceiptImage('');
      await loadRequests();
      refreshMe({ force: true });
    } finally {
      setBusy(false);
    }
  };

  const visiblePlans = plans.length ? plans : FALLBACK_PLANS;

  return (
    <div className="subscription-page-shell">
      <div className="subscription-page-topline"><Link to="/" className="subscription-back">{locale === 'ar' ? '← العودة للوحة التحكم' : '← Back to dashboard'}</Link><span className="subscription-local-note">{locale === 'ar' ? 'تفعيل يدوي آمن · بياناتك محفوظة محليًا' : 'Secure manual activation · data saved locally'}</span></div>
      <header className="subscription-page-hero"><div><span className="subscription-eyebrow">{t('subscriptionJourney')}</span><h1>{t('subscription')}</h1><p>{t('subscriptionDescription')}</p></div><div className="subscription-hero-orbit"><span>Edu<br />Core</span></div></header>
      <div className="subscription-current-summary"><span>{t('currentStatus')}</span><strong>{subscription?.plan ? planLabel(subscription.plan, t) : t('planTrial')}</strong><small>{subscription?.plan === 'trial' ? t('defaultTrial', '', { days: trialDays }) : statusLabel(subscription?.status, t)}</small></div>

      <SubscriptionDetailsCard />

      {myRequests.length > 0 && <section className="subscription-requests-card"><div className="subscription-section-heading"><div><span className="subscription-eyebrow">{t('requestHistory')}</span><h3>{t('subscriptionRequests')}</h3></div><span>{t('requestsCount', '', { count: myRequests.length })}</span></div><div className="subscription-requests-list">{myRequests.map((request) => <div key={request.id} className="subscription-request-row"><span><strong>{planLabel(request.plan, t)}</strong><small>{request.amount_omr} OMR {request.original_amount_omr && Number(request.original_amount_omr) > Number(request.amount_omr) ? <del>{request.original_amount_omr} OMR</del> : null}</small></span><span className={request.status === 'approved' ? 'is-good' : request.status === 'rejected' ? 'is-danger' : 'is-warning'}>{statusLabel(request.status, t)}</span></div>)}</div></section>}

      <div className="subscription-section-heading subscription-plans-heading"><div><span className="subscription-eyebrow">{t('flexiblePlans')}</span><h2>{t('choosePlan')}</h2><p>{t('plansDescription')}</p></div></div><div className="subscription-plans-grid">
        {visiblePlans.map((plan) => {
          const price = priceFor(plan);
          const original = originalPriceFor(plan);
          const hasOffer = Boolean(plan.offer && original > price);
          return <article key={plan.id} className={`subscription-plan-card ${plan.highlight ? 'is-highlighted' : ''} ${selectedPlan === plan.id ? 'is-selected' : ''}`}>
            {plan.highlight && <span className="subscription-plan-ribbon">{t('mostAttractive')}</span>}
            {hasOffer && <span className="subscription-offer-badge">{plan.offer.title || t('specialOffer')}</span>}
            <h3>{plan.id ? planLabel(plan.id, t) : plan.title}</h3>
            {hasOffer && <p className="subscription-original-price">{omrWithEquivalent(original)}</p>}
            <p className="subscription-plan-price">{price ? omrWithEquivalent(price) : '...'}</p>
            {hasOffer && plan.offer.description && <p className="subscription-offer-description">{plan.offer.description}</p>}
            {plan.note && <p className="subscription-plan-note">{plan.note}</p>}
            {Array.isArray(plan.features) && plan.features.length > 0 && <ul className="subscription-plan-features">{plan.features.map((feature) => <li key={feature}><span>✓</span>{feature}</li>)}</ul>}
            {plan.duration_days !== null && plan.duration_days !== undefined && <p className="subscription-plan-duration">{t('planValidity', '', { days: plan.duration_days })}</p>}
            {plan.duration_days === null && <p className="subscription-plan-duration">{t('unlimitedAccess')}</p>}
            <button className="btn-primary" onClick={() => { setSubmitted(false); setSelectedPlan(plan.id); }}>{t('chooseThisPlan')}</button>
          </article>;
        })}
      </div>

      {selected && <section ref={activationRef} className="subscription-activation-card scroll-mt-6">
        <h3 className="font-bold mb-3">{t('activationTitle')}</h3>
        <ol className="list-decimal list-inside text-sm text-ink/80 space-y-2 mb-5"><li>{t('activationStep1')} <span className="font-bold text-primary">{omrWithEquivalent(priceFor(selected))}</span> — <span className="font-bold">{phone}</span></li><li>{t('activationStep2')}</li><li>{t('activationStep3')}</li></ol>
        {submitted ? <p className="text-primary font-medium">{t('requestSent')}</p> : <form onSubmit={submitRequest} className="space-y-3"><div><label className="label">{t('transferReference')}</label><input className="input" value={referenceNote} onChange={(e) => setReferenceNote(e.target.value)} placeholder={locale === 'ar' ? 'مثال: تحويل باسم أحمد - 123456' : 'e.g. Transfer by Ahmed - 123456'} /></div><div><label className="label">{t('receiptOptional')}</label><input type="file" accept="image/*" onChange={handleReceipt} className="text-sm" />{receiptImage && <img src={receiptImage} alt={t('receiptOptional')} className="mt-2 max-h-40 rounded-lg border border-line" />}</div><div className="flex gap-2"><button className="btn-primary" disabled={busy} type="submit">{busy ? '...' : t('submitActivation')}</button><button className="btn-secondary" type="button" onClick={() => setSelectedPlan(null)}>{t('cancel')}</button></div></form>}
      </section>}
      <p className="subscription-footnote">{t('manualActivationNote')}</p>
    </div>
  );
}
